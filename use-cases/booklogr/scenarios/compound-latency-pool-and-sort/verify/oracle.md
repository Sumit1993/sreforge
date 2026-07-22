# Oracle — compound-latency-pool-and-sort (v1 mitigation)

This scenario uses the `incident` profile: the agent's fix is **deployed live**
and scored by observing behavior, not by matching a diff. v1 ships an objective,
no-LLM **mitigation oracle**.

## CompoundedOracle contract

The full oracle is a weighted `CompoundedOracle` over the incident lifecycle:

```text
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

Compound latency degradation caused by two independent, independently-sufficient faults delivered as separate commits:
1. **Cause 1 (Older commit):** DB connection pool limited to size 1 with 8 Gunicorn threads per process (`api/config.py` and `gunicorn.conf.py`), serializing uncached reads on a single database connection.
2. **Cause 2 (Recent commit):** Full-library in-memory fetch, NFKD Unicode normalization, and Python-side sorting (`api/routes/books.py`), pinning CPU on every `/v1/books` request.

**The fix family:** Any change that addresses BOTH bottlenecks (restores DB pool capacity/sync workers AND restores database-side pagination). The oracle grades **behavior**, not a diff match.

## Partial Mitigation Anti-Cheat (ADR-0004)

Partial mitigation (reverting one of the two culprit commits) leaves p99 > 0.3 s because the surviving cause is independently sufficient; `alert_cleared` (fail-closed, weight 0.35) therefore fails and the run cannot reach 0.85. This is the ADR-0004 anti-cheat — no compound-specific oracle rule is added.

## Scoring model (v1)

The deploy loop the oracle observes:

```text
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build booklogr-api && up -d booklogr-api
  → oracle scores under STILL-ACTIVE k6 storm load
```

The agent never deploys directly. The k6 storm keeps running the **entire** time — including while the
oracle scores. This is the **ADR-0004 anti-cheat**: the alert may clear only because
the deployed fix works, never because load stopped.

A run is **mitigated** when every pass/fail signal below is satisfied.

## Signals

| Signal | Type | Weight | Measure |
|---|---|---|---|
| `ci_green` | hard gate | 0.25 | substrate CI green on the fix commit |
| `alert_cleared` | hard, fail-closed | 0.35 | `BooklogrApiLatencyP99High` absent from firing set; p99 PromQL < 0.3 s |
| `sustained_clear` | hard | 0.20 | stays cleared `sustained_clear_seconds = 360` under **still-active** storm (> substrate cache TTL 300s, #66) |
| `time_to_clear` | soft (recorded) | 0.10 | seconds redeploy→first clear |
| `no_new_alerts` | soft | 0.10 | no new firing alert among `services = ["booklogr-api"]` |

### PromQL expression

Prometheus metric used to score `alert_cleared` and `sustained_clear`:

```promql
histogram_quantile(0.99, sum by (le) (rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[30s])))
```

### Timing constants

- `confirm_fire_timeout_seconds = 240`
- `sustained_clear_seconds = 360`
- `p99_threshold_seconds = 0.3`

## Pass threshold and rationale

```text
passThreshold = 0.85
```

The three **hard** signals sum to **0.80**:

| Signal | Weight | Type |
| --- | --- | --- |
| `ci_green` | 0.25 | hard gate |
| `alert_cleared` | 0.35 | hard |
| `sustained_clear` | 0.20 | hard |

Reaching 0.85 therefore requires all three hard signals (0.80) **plus** at least
0.05 of soft credit from `time_to_clear` / `no_new_alerts`.

Fail-closed short-circuits:
1. `ci_green` is false → fix not deployed; run fails immediately.
2. `alert_cleared` is never observed within the oracle window → run fails; `sustained_clear` and soft signals are not evaluated.
3. Container not redeployed → run fails.

## Deferred to v2

- **Diagnosis / RCA LLM-judge** — grades whether the agent's written root-cause explanation correctly identifies **both** independent causes (DB connection pool limit + in-memory Python sort).
