# Oracle — db-pool-exhaustion-deploy (v1 mitigation)

This scenario uses the `incident` profile: the agent's fix is **deployed live**
and scored by observing behavior, not by matching a diff. v1 ships an objective,
no-LLM **mitigation oracle**.

## CompoundedOracle contract

The full oracle is a weighted `CompoundedOracle` over the incident lifecycle:

```
score = Σ ( weight_i · signal_i )   over phases: detect → diagnose → mitigate
```

- **detect** — did the agent identify the firing alert / affected signal?
- **diagnose** — did the agent correctly explain the root cause (RCA)?
- **mitigate** — did the deployed fix actually resolve the incident?

**v1 ships only the `mitigate` phase.** `detect` and `diagnose` are stubbed at
weight 0. The mitigation oracle is fully objective (Prometheus + CI exit codes,
no LLM judge). The contract is shaped so the v2 diagnosis/RCA LLM-judge drops in
as an additional weighted phase **without refactoring** the mitigation signals.

## Root cause (harness-internal)

DB pool exhaustion: A configuration change committed right before the incident reduced the database connection pool (`SQLALCHEMY_ENGINE_OPTIONS = {"pool_size": 1, "max_overflow": 0, "pool_timeout": 5}`) and switched gunicorn to threaded workers (`worker_class = "gthread"`, `threads = 8`). While healthy sync single-request-per-process workers never contend a 1-connection pool, the faulted threaded workers outrun their own process's 1-connection pool. A pool size of 1 serializes every uncached `/v1/books` list read. At the storm's read rate, this saturates the single connection. As threads block on database I/O, all 8 of Gunicorn's thread slots per process become starved, causing even lightweight cached search traffic (`/v1/books/search`) to queue at accept and time out, breaching the p99 threshold continuously and firing `BooklogrApiLatencyP99High`. 

**The fix family:** Any change that stops the single connection from serializing reads. Acceptable fixes include reverting the pool-limiting commit, raising `pool_size`/`max_overflow` back to provide headroom above the storm's concurrent-read demand, removing the `SQLALCHEMY_ENGINE_OPTIONS` override entirely so it falls back to defaults, or reverting to sync workers. The oracle grades **behavior**, not a diff match.

## Scoring model (v1)

The deploy loop the oracle observes:

```
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build booklogr-api && up -d booklogr-api
  → oracle scores under STILL-ACTIVE k6 storm load
```

The agent never deploys directly. The k6 storm keeps running the **entire** time — including while the
oracle scores. This is the **ADR-0004 anti-cheat**: the alert may clear only because
the deployed fix works, never because load stopped.

A run is **mitigated** when every pass/fail signal below is satisfied.

## Signals

### (a) `ci_green` — pass/fail (hard gate)   weight 0.25

CI must pass before the fix is merged and deployed. The gate is the Gitea
Actions workflow `.gitea/workflows/ci.yml`, which runs two steps:

- **Build:** `docker build` of the `booklogr-api` image exits 0.
- **Smoke:** a container smoke test (`GET /`) against the freshly built image
  exits 0 (HTTP 200).

booklogr ships **no unit tests**; CI proves deployability only. The ADR-0004
behavioral oracle is the authoritative correctness check.

If `ci_green` fails, the fix is **not deployed** and the run **cannot pass**
(fail-closed short-circuit).

### (b) `alert_cleared` — pass/fail (hard)   weight 0.35

After redeploy, `BooklogrApiLatencyP99High` must be **absent from the firing
set**. Measured by polling Prometheus:

```
GET http://localhost:9090/api/v1/alerts
→ no alert with labels.alertname == "BooklogrApiLatencyP99High" and state == "firing"
```

Equivalently, the locked P99 PromQL expression:

```promql
histogram_quantile(0.99, sum by (le) (rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[30s])))
```

must sit **below the 0.3 s threshold**.

If `alert_cleared` has not been observed before the oracle window expires, the
run fails regardless of other signals (fail-closed short-circuit on the hard
signals).

### (c) `sustained_clear` — pass/fail (hard)   weight 0.20

The alert must **stay cleared for `sustained_clear_seconds`** (360 s) while the
k6 storm is **still running**. A brief dip below threshold does not count — the
oracle requires continuous clearance across the full window
(`maxClearTimeSeconds = 180`, `sustainedClearSeconds = 360`; exceeds substrate cache TTL `CACHE_DEFAULT_TIMEOUT=300s` so cache-masking cannot pass, #66). This is the core
of the ADR-0004 anti-cheat: sustained clearance under active load can only come from
a working fix.

### (d) `time_to_clear` — recorded (soft, not pass/fail)   weight 0.10

Seconds from redeploy completion to the first observed clear of
`BooklogrApiLatencyP99High`. Recorded as a run metric for analysis and
leaderboards; it does **not** gate the pass decision. Faster clears score
proportionally higher within the soft weight.

### (e) `no_new_alerts` — pass/fail (soft)   weight 0.10

No other alert may transition into the firing state after the fix is deployed
(regression guard). In particular:

- `BooklogrApiHighErrorRate` (5xx ratio > 0.05) must not fire or must clear.
- `BooklogrApiDown` (`up == 0`) must not fire.
- No new latency, error-rate, or availability alert may appear.

A fix that resolves p99 latency while introducing a new error-rate spike fails
this signal.

## Pass threshold and rationale

```
passThreshold = 0.85
```

The three **hard** signals sum to **0.80**:

| Signal            | Weight | Type      |
| ----------------- | ------ | --------- |
| `ci_green`        | 0.25   | hard gate |
| `alert_cleared`   | 0.35   | hard      |
| `sustained_clear` | 0.20   | hard      |

Reaching 0.85 therefore requires the three hard signals (0.80) **plus** at least
0.05 of soft credit from `time_to_clear` / `no_new_alerts`. The load-bearing
property is what **fails**:

- A fix that clears the alert briefly but does **not** sustain clearance under
  the active storm forfeits the 0.20 `sustained_clear` weight, so it scores at
  most **0.80** (`ci_green + alert_cleared` + soft credit) and fails. This is the
  **ADR-0004 anti-cheat**: a surface-level mitigation that does not survive the load
  cannot reach 0.85.
- A fix that never clears at all scores at most ~0.35 (`ci_green +
  no_new_alerts`) and fails.

`time_to_clear` and `no_new_alerts` are **soft**: a sustained, regression-free
fix passes comfortably (≈0.90–0.98 regardless of clear speed), while a genuine regression (a newly firing alert)
costs 0.10 and, combined with a slow clear, can pull even an otherwise-sustained
fix below 0.85.

Fail-closed short-circuits (run aborted before scoring completes):

1. `ci_green` is false → fix not deployed; run fails immediately.
2. `alert_cleared` is never observed within the oracle window → run fails;
   `sustained_clear` and soft signals are not evaluated.
3. Container not redeployed (harness detects no restart after merge) → run
   fails; oracle does not score stale behavior.

## Deferred to v2

- **Diagnosis / RCA LLM-judge** — grades whether the agent's written root-cause
  explanation correctly identifies the database connection pool limit as the
  source of the incident. Adds the `diagnose` phase weight to the
  `CompoundedOracle`. The v1 mitigation signals above are unchanged (no refactor
  required).
- **`detect` phase** — grades alert / signal identification speed and accuracy.
