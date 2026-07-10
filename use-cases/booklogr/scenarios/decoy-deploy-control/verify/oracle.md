# Oracle — decoy-deploy-control (v1 mitigation)

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

The deployed cache backend has drifted to `NullCache` at the runtime/infra
layer: a compose-level `.env` override (`CACHE_TYPE=NullCache`) sits in the
deploy directory, invisible to `git log` on the application repo. The
application itself reads `CACHE_TYPE` from the environment (a legitimate
12-factor idiom, `api/config.py`), defaulting to `SimpleCache` — so under a
normal deploy the cache is on, and only this specific runtime override turns
it off. With the cache off, every `/v1/books/search` request misses and calls
`BookProvider()` — the book-metadata upstream, modeled as a deterministic slow
call (1.1-1.3s). Under a k6 constant-arrival-rate storm (25 req/s) over a fixed
8-query working set, the gunicorn workers back up and p99 climbs past 0.3s,
firing `BooklogrApiLatencyP99High` — mechanically identical to
`latency-cache-stampede`, but the CAUSE is a runtime config override, not an
application-code regression.

**The decoy:** a real commit landed on `main` at roughly the same time
(`inject/fault.patch`, "Fix invalid HTTP status in settings response") — a
one-line fix to an unrelated bug (`}), 40` → `}), 400` in
`api/routes/settings.py`). It is a genuine, harmless, real-timestamped deploy.
It is physically incapable of affecting search latency: it touches a different
endpoint, a different file, and does not read or write `CACHE_TYPE` or
anything cache-related.

**The fix family:** any change that stops the runtime `CACHE_TYPE` override
from reaching the effective cache backend — see
`solution/reference-fix.md` for the accepted families. The oracle grades
**behavior**, not a diff match against `solution/fix.patch`.

## Scoring model (v1)

The deploy loop the oracle observes:

```
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build booklogr-api && up -d booklogr-api
  → oracle scores under STILL-ACTIVE k6 storm load
```

The agent never deploys directly. The k6 storm keeps running the **entire**
time — including while the oracle scores. This is the **ADR-0004 anti-cheat**:
the alert may clear only because the deployed fix works, never because load
stopped.

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

The alert must **stay cleared for `sustained_clear_seconds`** (30 s) while the
k6 storm is **still running**. A brief dip below threshold does not count — the
oracle requires continuous clearance across the full window
(`maxClearTimeSeconds = 180`, `sustainedClearSeconds = 30`). This is the core
of the ADR-0004 anti-cheat: sustained clearance under active load can only come
from a working fix.

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

Reaching 0.85 therefore requires the three hard signals (0.80) **plus** at
least 0.05 of soft credit from `time_to_clear` / `no_new_alerts`.

Fail-closed short-circuits (run aborted before scoring completes):

1. `ci_green` is false → fix not deployed; run fails immediately.
2. `alert_cleared` is never observed within the oracle window → run fails;
   `sustained_clear` and soft signals are not evaluated.
3. Container not redeployed (harness detects no restart after merge) → run
   fails; oracle does not score stale behavior.

## MANDATORY negative test (the discriminating property of this scenario)

This scenario exists specifically to check that a fix addresses the actual
mechanism rather than merely reverting the most recent commit. The negative
test:

1. Arm the incident normally (`SCENARIO_ID=decoy-deploy-control`, mode 3
   `arm-runtime-notrace` — deploys the innocent settings.py fix AND writes the
   `CACHE_TYPE=NullCache` runtime override).
2. Submit `verify/negative-fixture.patch` (the revert of `inject/fault.patch`,
   reintroducing the `}), 40` bug) as the fix instead of the reference fix,
   e.g.:
   ```bash
   node scripts/run-incident.mjs --patch \
     ../../scenarios/decoy-deploy-control/verify/negative-fixture.patch \
     --message "Revert HTTP status fix" --scenario-id decoy-deploy-control
   ```
3. **Required outcome:** `alert_cleared` is never observed (the revert does not
   touch `CACHE_TYPE` or `api/config.py` at all — the runtime override is
   completely untouched by this fix) → the run fails, verdict `failed`.

If this negative test instead passes, the scenario's persistence property
(the compose `.env` override surviving an unrelated redeploy) has regressed —
see `solution/reference-fix.md` for why persistence is the load-bearing
mechanism, and `scripts/lib-fault-delivery.sh` / `scripts/arm-incident.sh` for
where it is implemented.

## Deferred to v2

- **Diagnosis / RCA LLM-judge** — grades whether the agent's written root-cause
  explanation correctly identifies the runtime cache override (and explicitly
  rules out the innocent recent commit) as the source of the incident. Adds
  the `diagnose` phase weight to the `CompoundedOracle`. The v1 mitigation
  signals above are unchanged (no refactor required).
- **`detect` phase** — grades alert / signal identification speed and
  accuracy.
