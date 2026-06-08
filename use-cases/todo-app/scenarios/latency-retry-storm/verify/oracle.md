# Oracle — latency-retry-storm (v1 mitigation)

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

## Scoring model (v1)

The deploy loop the oracle observes:

```
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build api && up -d api  → oracle scores under STILL-ACTIVE load
```

The agent never deploys. The storm load driver
(`node load/driver.mjs --mode=storm`) keeps running the entire time — including
while the oracle scores. This is the **D4 anti-cheat**: the alert may clear only
because the deployed fix works, never because load stopped.

A run is **mitigated** when every pass/fail signal below is satisfied.

## Signals

### (a) `ci_green` — pass/fail (gate)

CI must pass before the fix is merged and deployed. Two checks:

- **Build:** `pnpm --filter todo-app-api-nestjs build` exits 0
  (runs `nest build`).
- **Tests:** the api Jest suite passes — `pnpm --filter todo-app-api-nestjs test`
  (runs `jest`) exits 0.

If `ci_green` fails, the fix is **not deployed** and the run cannot pass.

### (b) `alert_cleared` — pass/fail

After redeploy, `TodoApiLatencyP99High` must be **absent from the firing set**.
Measured by polling Prometheus:

```
GET http://localhost:9090/api/v1/alerts
→ no alert with labels.alertname == "TodoApiLatencyP99High" and state == "firing"
```

Equivalently, the p99 query
`histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="todo-app-api"}[30s])))`
sits below the `0.3s` threshold.

### (c) `sustained_clear` — pass/fail

The alert must **stay cleared for `sustained_clear_seconds`** (30s; see
`scenario.toml [determinism]`) while the storm load is **still running**. A brief
dip below threshold does not count — the oracle requires continuous clearance
across the window. This is the core of the D4 anti-cheat: sustained clearance
under active load can only come from a working fix.

### (d) `time_to_clear` — recorded (not pass/fail)

Seconds from redeploy completion to first observed clear of
`TodoApiLatencyP99High`. Recorded as a run metric for analysis and leaderboards;
it does **not** affect pass/fail.

### (e) `no_new_alerts` — pass/fail

No other alert may transition into the firing state after the fix is deployed
(regression guard). In particular, the 5xx error-rate alert must also clear
(malformed DELETEs now return a fast 4xx, not a slow 5xx) and no new latency,
error, or availability alert may appear.

## Pass criteria

| Signal            | Type      | Pass condition                                            |
| ----------------- | --------- | --------------------------------------------------------- |
| `ci_green`        | gate      | build + jest both exit 0                                  |
| `alert_cleared`   | pass/fail | `TodoApiLatencyP99High` not in firing set after redeploy  |
| `sustained_clear` | pass/fail | stays cleared for `sustained_clear_seconds` under load    |
| `no_new_alerts`   | pass/fail | no other alert transitions to firing post-fix             |
| `time_to_clear`   | recorded  | (metric only — no threshold)                              |

A run **passes** when `ci_green`, `alert_cleared`, `sustained_clear`, and
`no_new_alerts` all pass.

## Deferred to v2

- **Diagnosis / RCA LLM-judge** — grades whether the agent's written root-cause
  explanation is correct. Adds the `diagnose` phase weight to the
  `CompoundedOracle`. The v1 mitigation signals above are unchanged by this
  addition (no refactor required).
- **`detect` phase** — grades alert/signal identification.
