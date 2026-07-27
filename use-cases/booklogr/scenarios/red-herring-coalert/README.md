# red-herring-coalert

An `incident`-profile SREForge scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** a cache stampede on book search under storm load drives p99 latency above the 300 ms SLO and fires `BooklogrApiLatencyP99High`, while a concurrent `BookMetadataProviderErrorsElevated` warning alert fires on the upstream `book-metadata` provider; the agent must triage the co-alert as non-causal and restore search caching.

The agent is paged with the firing `BooklogrApiLatencyP99High` alert. Upon inspecting Alertmanager or Prometheus, the agent observes two active alerts:
1. `BooklogrApiLatencyP99High` (`service="booklogr-api"`, critical) — p99 request latency > 300 ms on search.
2. `BookMetadataProviderErrorsElevated` (`service="book-metadata"`, warning) — elevated 5xx error rate from the upstream provider.

The true cause of the latency incident is disabled response caching (`CACHE_TYPE = "NullCache"` in `api/config.py`). Uncached search requests block Gunicorn workers on slow successful upstream calls (1200 ms). The concurrent upstream 5xx responses are fast errors (0 ms delay), which do not add latency or cause the p99 breach.

Restoring effective caching for search requests clears `BooklogrApiLatencyP99High` under active load; as upstream search traffic subsides post-fix, `BookMetadataProviderErrorsElevated` subsides as well — expected, and irrelevant to causality.

## Architecture and Design Rules

- **Grader scoping (ADR-0006):** `scenario.toml` declares `services = ["booklogr-api"]`. The `BookMetadataProviderErrorsElevated` alert carries `service="book-metadata"`, placing it outside the scenario's grader scope so it cannot dock the `no_new_alerts` mitigation grade.
- **Signal multiplicity & triage (ADR-0022):** The co-firing alert tests diagnostic triage. A correct RCA dismisses the upstream alert as non-causal.
- **Diagnosis judging (ADR-0027):** The scenario ground truth in `verify/oracle.md` explicitly designates `BookMetadataProviderErrorsElevated` as non-causal. An RCA blaming `book-metadata` trips the `false_leads` axis in `tools/rca-judge`.
- **De-tell (ADR-0008):** All alert names, labels, and annotations use standard organic operational terminology without synthetic markers.
- **Deterministic firing (ADR-0010):** The upstream error injection (`SEARCH_STUB_5XX_RATE=0.08`) uses a deterministic request-count selector in the `book-metadata` stub, ensuring reproducible alert firing across arms.
- **Shared surface rule addition (ADR-0026):** The alert rule is added to `observability/rules/book-metadata-rules.yml` and is dormant when `SEARCH_STUB_5XX_RATE=0`.

## Layout

| File | Purpose |
| ---- | ------- |
| `scenario.toml` | Machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/README.md` | Pointer describing fault injection and arm-time env override |
| `solution/fix.patch` | Canonical reference fix (restore `SimpleCache` in `api/config.py`) |
| `solution/reference-fix.md` | Explanation of reference fix |
| `verify/oracle.md` | Oracle specification (mitigation signals + ground-truth root cause) |
| `verify/negative-fixture.patch` | Non-mitigating patch for negative testing |
| `verify/headroom.md` | Physics-acceptance notes and cold-arm expectations |

## Run it end to end

```bash
# from use-cases/booklogr/stacks/flask-compose/
bash scripts/smoke-positive.sh        # reference fix: must PASS
bash scripts/smoke-negative.sh        # a non-mitigating fix: must NOT pass (ADR-0004 anti-cheat)
```

## Inspect the running stack

| Resource | URL |
| -------- | --- |
| booklogr API | http://localhost:5000 |
| booklogr web | http://localhost:5150 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3002 |
