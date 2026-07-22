# Oracle — red-herring-coalert (v1 mitigation + diagnosis ground truth)

This scenario uses the `incident` profile on the `booklogr` / `flask-compose` stack. The agent's fix is **deployed live** and scored by observing behavior.

## CompoundedOracle contract

The full oracle evaluates three phases across the incident lifecycle:

```
score = Σ ( weight_i · signal_i )   over phases: detect → diagnose → mitigate
```

- **detect** — did the agent identify the firing alert / affected signal?
- **diagnose** — did the agent correctly explain the root cause (RCA) and triage false leads?
- **mitigate** — did the deployed fix resolve the incident under active load?

v1 mitigation scoring is objective (Prometheus + CI exit codes, no LLM judge). Diagnosis is evaluated by `tools/rca-judge` against the ground-truth root cause section below.

## Root cause (harness-internal)

The search-response cache is disabled — `CACHE_TYPE = "NullCache"` in `api/config.py`. Normally `/v1/books/search` is decorated with `@cache.cached(query_string=True)` over `SimpleCache` (`CACHE_DEFAULT_TIMEOUT = 300`). With `NullCache`, every search request misses the cache and calls `BookProvider()` on the `book-metadata` upstream service (1200 ms latency). Under a k6 constant-arrival-rate storm (25 req/s) over a fixed 8-query working set, the 4 Gunicorn workers saturate, request queueing builds up, and p99 latency climbs past 0.3 s, triggering `BooklogrApiLatencyP99High`.

### Co-firing Red-Herring Alert Triage (ADR-0022, ADR-0027)

A concurrent `BookMetadataProviderErrorsElevated` warning was firing on the `book-metadata` upstream provider; it is not on the causal path — the latency breach is driven by cache-miss stampede, and the provider's fast error responses do not add request latency.

Physics explanation for triage:
1. The injected 5xx responses from `book-metadata` return HTTP 503 **immediately** (0 ms delay), whereas successful uncached lookups wait 1200 ms. Fast error responses do not increase p99 request duration.
2. The SLO breach (`BooklogrApiLatencyP99High`) is caused by cache-miss stampede over the successful slow upstream calls.
3. Re-enabling search response caching clears `BooklogrApiLatencyP99High` completely; as upstream search traffic subsides post-fix, `BookMetadataProviderErrorsElevated` subsides too — expected behavior, and irrelevant to causality.

**Diagnosis judgement (`tools/rca-judge` / ADR-0027):**
- **Correct triage:** An RCA that identifies the disabled search cache (`NullCache`) as the root cause and dismisses `book-metadata` provider errors as non-causal scores `root_cause_correct = true` and `false_leads = false`.
- **False lead failure:** An RCA that attributes the incident to `book-metadata` provider errors or recommends fixing/scaling `book-metadata` trips `false_leads = true` and forfeits 0.2 of its diagnosis score.

**The fix family:** any change that re-enables effective caching of `/v1/books/search` (restore `SimpleCache`, real backend, or per-query memoisation). The mitigation oracle grades **behavior**, not diff matching.

## Scoring model (v1 mitigation)

The deploy loop:

```
agent edits run workspace → sreforge submit → CI gate → (green) auto-merge
  → docker compose build booklogr-api && up -d booklogr-api
  → oracle scores under STILL-ACTIVE k6 storm load
```

The k6 storm (`docker compose -p booklogr-edge -f compose/load.yml up -d`) runs continuously throughout verification (**ADR-0004 anti-cheat**).

## Signals

### (a) `ci_green` — pass/fail (hard gate)   weight 0.25
CI must pass before the fix is merged and deployed (`.gitea/workflows/ci.yml`). Fail-closed short-circuit: if CI fails, the fix is not deployed and the run fails.

### (b) `alert_cleared` — pass/fail (hard)   weight 0.35
`BooklogrApiLatencyP99High` must be absent from the firing set in Prometheus:
`histogram_quantile(0.99, sum by (le) (rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[30s]))) < 0.3`.

### (c) `sustained_clear` — pass/fail (hard)   weight 0.20
The alert must stay cleared for `sustained_clear_seconds` (30 s) while the k6 storm is still active.

### (d) `time_to_clear` — recorded (soft)   weight 0.10
Seconds from redeploy completion to the first clear of `BooklogrApiLatencyP99High`.

### (e) `no_new_alerts` — pass/fail (soft)   weight 0.10
No other in-scope alert (`BooklogrApiHighErrorRate`, `BooklogrApiDown`) may transition to firing post-fix.
`scenario.toml` sets `services = ["booklogr-api"]` (ADR-0006 amended scoping). The co-firing alert `BookMetadataProviderErrorsElevated` carries `service="book-metadata"` and is excluded from `no_new_alerts`.

## Pass threshold

```
passThreshold = 0.85
```

Reaching 0.85 requires all three hard signals (`ci_green` 0.25 + `alert_cleared` 0.35 + `sustained_clear` 0.20 = 0.80) plus soft credit.
