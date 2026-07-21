# Oracle — worker-cpu-starvation (v1 mitigation)

This scenario uses the `incident` profile: the agent's fix is **deployed live**
and scored by observing behavior, not by matching a diff. v1 ships an objective,
no-LLM **mitigation oracle**. The signal set and weights are **identical** to
`db-pool-exhaustion-deploy` — the mitigation oracle is unchanged.

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

> This is a **multi-alert storm** scenario, but storm-grouping / correlation is a
> **diagnosis** concern (the #56 judge), **not** a mitigation gate. The oracle
> below scores only whether the primary alert clears and sustains. No verify
> signal reads the cross-service `book-metadata` alert — adding one would turn a
> diagnosis question into a mitigation gate, which v1 deliberately does not do.

## Root cause (harness-internal)

**CPU starvation of the Gunicorn worker pool by a full-library re-sort on the hot
read path.** A recent deploy changed `GET /v1/books` (`api/routes/books.py`,
`get_books`) to order the library in the application instead of the database: it
now calls `books.all()` — hydrating the owner's **entire** 150k-row library into
ORM objects — computes a per-row Unicode-normalized, article-insensitive sort key,
sorts the whole list in Python, and only then slices out the requested page. The
per-request cost (full-result-set ORM hydration + a 150k-element Unicode sort) is
**CPU-bound**, not I/O-bound. Under the constant-arrival-rate library-read storm,
all four Gunicorn **sync** workers saturate their CPU. Once the workers are pinned,
every endpoint queues at accept — including cached routes (`/v1/books/search`) and
book-detail lookups — so the path-agnostic service p99
(`flask_http_request_duration_seconds`) breaches the 300 ms SLO continuously and
fires `BooklogrApiLatencyP99High`.

**The fix family:** any change that stops the per-request full-library
materialize/sort so the read path no longer pins the workers' CPU — revert the
shelf-ordering commit, restore database-side `ORDER BY` + `LIMIT/OFFSET`
pagination, or bound the app-side ordering to the requested page. The oracle grades
**behavior**, not a diff match. See `../solution/reference-fix.md`.

## Storm propagation — the cross-service signal (harness-internal reasoning)

The scenario deliberately produces a **second, cross-service** alert on a
different service (`service: book-metadata`) so a solver must group the storm
into one incident with a shared cause. The physics, reasoned from the actual
substrate:

1. **The API is the book-metadata provider's only consumer.** The provider (our
   stub, `stub/book_metadata_api.py`) is called synchronously by the API on the
   book-detail path (`GET /v1/books/<isbn>` → `BookProvider.get`). The browse-mixed
   storm keeps a steady, low-rate, **uncached** trickle of out-of-library
   book-detail lookups flowing, so under a healthy baseline the provider serves a
   steady inbound request rate.
2. **Under CPU starvation the API stops driving that traffic.** When the four
   workers are pinned by the library re-sort, browse/detail requests pile up in the
   API's accept queue and mostly never reach the point of calling the provider (many
   time out first). The provider's **inbound request rate collapses** toward zero.
   This is the signal that genuinely moves, and it is what
   `BookMetadataTrafficStalled` fires on (current rate collapsed below a ratio of its
   trailing baseline, guarded by a min-baseline qualifier so it only fires on an
   active→stalled transition, never on a genuinely idle provider).
3. **In-flight PILEUP does NOT occur — and that is the sharp physics point.** One
   might expect the starved, slow-reading client to back-pressure the provider and
   pile up in-flight handlers. It does not: the provider's response bodies are tiny
   (a few hundred bytes), so they fit entirely in the socket send buffer and the
   provider's `wfile.write` **never blocks** on a slow reader. With no write
   back-pressure, handler lifetime stays ≈ the fixed ~1.1-1.3 s upstream delay
   regardless of client speed, so neither the in-flight gauge nor the
   response-duration histogram rises. Only the **arrival rate** falls. We therefore
   alert on rate collapse, not on in-flight elevation.

**Why the baseline stays clean.** The provider's responses are slow by design
(~1.2 s). The primary latency alert is path-agnostic (service-wide p99), so any
book-detail request that hits the provider sits at ~1.2 s. The coupling stream is
kept **well under ~1 % of total request volume** (≈0.33 req/s against a
`RATE=50` library stream), so those slow requests land **above** the 99th
percentile and do not move the healthy-baseline p99. Under the fault the library
stream's own p99 explodes past threshold, so the primary alert is driven by the
CPU starvation, not by the coupling stream.

**Thresholds are provisional (`# TUNE-ON-CERT`).** The collapse ratio,
min-baseline qualifier, and baseline window/offset in `book-metadata-rules.yml`, and the
coupling stream's rate in the storm, are all provisional and must be tuned against
live certification soak data. See the README "CERTIFICATION PENDING" section for
the specific open questions (including cross-scenario interference: a rate-collapse
alert on a **shared** rules surface can interact with `latency-cache-stampede`,
whose correct fix legitimately reduces provider traffic).

## Scoring model (v1)

The deploy loop the oracle observes:

```
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build booklogr-api && up -d booklogr-api
  → oracle scores under STILL-ACTIVE k6 storm load
```

The agent never deploys directly. The k6 storm keeps running the **entire** time —
including while the oracle scores. This is the **ADR-0004 anti-cheat**: the alert
may clear only because the deployed fix works, never because load stopped.

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

Note: `BookMetadataTrafficStalled` is expected to **clear** once the fix restores
the API's normal call volume to the provider — that is the correct post-fix
state, not a regression.

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
  explanation correctly identifies the full-library re-sort on the hot read path
  as the source of the incident, **and** whether the agent grouped the multi-service
  storm (`booklogr-api` latency + `book-metadata` traffic collapse) into one
  incident with a shared cause. Adds the `diagnose` phase weight to the
  `CompoundedOracle`. The v1 mitigation signals above are unchanged (no refactor
  required).
- **`detect` phase** — grades alert / signal identification speed and accuracy.
