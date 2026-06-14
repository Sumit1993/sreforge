# [PAGE] BooklogrApiLatencyP99High — booklogr-api

**Status:** FIRING
**Severity:** critical
**Service:** `booklogr-api`
**Started:** `<ALERT_FIRED_AT>` <!-- RFC3339 timestamp, set at runtime -->

## Summary

p99 request latency on `booklogr-api` has been above **300ms** for a sustained
period. The alert `BooklogrApiLatencyP99High` is firing in Alertmanager.

Current p99 is well above the **300ms SLO** against a healthy baseline well
under **100ms**. Requests are completing but slowly. Users are seeing degraded
response times across the service.

## Your task

**Investigate and resolve.** Find why p99 latency is elevated, apply a fix to
the service, and submit it. The incident is resolved when latency returns below
the SLO and the alert clears on its own.

## Available tools and endpoints

| Resource          | Endpoint / location                                              |
| ----------------- | ---------------------------------------------------------------- |
| Prometheus        | http://localhost:9090                                            |
| Alertmanager      | http://localhost:9093                                            |
| Grafana           | http://localhost:3002                                            |
| booklogr API      | http://localhost:5000                                            |
| API metrics       | aggregated on the dedicated `:9090` target (job `booklogr-api`) |
| Service source    | the `api/` directory in your run workspace                       |

Useful starting points:

- **p99 latency** (PromQL):
  ```promql
  histogram_quantile(0.99, sum by (le) (rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[30s])))
  ```
- **Request rate by endpoint**:
  ```promql
  sum by (endpoint, method, status) (rate(flask_http_request_duration_seconds_count{job="booklogr-api"}[1m]))
  ```
- Alert state and firing set: Prometheus `/api/v1/alerts`, or the Alertmanager UI.

## Submitting a fix

Edit the service source in your run workspace, then submit:

```bash
sreforge submit
```

Your change is built and tested before it goes live. Once it passes, it is
deployed automatically — you do not need to deploy or restart anything yourself.
After deploy, latency and alert state are observed to confirm the incident is
resolved.
