# [PAGE] TodoApiLatencyP99High — todo-api

**Status:** FIRING
**Severity:** critical
**Service:** `todo-api`
**Started:** `<ALERT_FIRED_AT>` <!-- RFC3339 timestamp, injected at runtime -->

## Summary

p99 request latency on `todo-api` has been above **300ms** for a sustained
period. The alert `TodoApiLatencyP99High` is firing in Alertmanager.

Current p99 is roughly **0.49s** against a normal baseline of **≤ 0.1s**.
Requests are completing but slowly, and a portion are returning HTTP 5xx.
Users are seeing degraded response times.

## Your task

**Investigate and resolve.** Find why p99 latency is elevated, apply a fix to
the service, and submit it. The incident is resolved when latency returns below
the SLO and the alert clears on its own.

## Available tools and endpoints

| Resource          | Endpoint / location                                     |
| ----------------- | ------------------------------------------------------- |
| Prometheus        | http://localhost:9090                                   |
| Alertmanager      | http://localhost:9093                                   |
| Grafana           | http://localhost:3002                                   |
| Todo API          | http://localhost:3000/api                               |
| API metrics       | http://localhost:3000/api/metrics                       |
| Service source    | the `apps/api` directory in your run workspace          |

Useful starting points:

- **p99 latency** (PromQL):
  ```promql
  histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="todo-app-api"}[30s])))
  ```
- **Error rate by route/status**:
  ```promql
  sum by (route, status) (rate(http_request_duration_seconds_count{job="todo-app-api"}[1m]))
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
