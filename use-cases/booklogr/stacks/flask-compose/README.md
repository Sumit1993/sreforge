# booklogr — flask-compose stack

The harness-side overlay that turns the imported **booklogr** substrate into a
lived-in, observable deployment with a local Git forge (CI/CD) and a load
driver over booklogr's Flask/Postgres stack (ADR-0014/ADR-0015).

> The booklogr app itself is **not** in this tree. It's imported into the local
> Gitea forge and checked out (gitignored) at `substrate/booklogr` as the build
> context. The observability/load/CI overlay lives here, in the harness, never
> inside the substrate repo (build-invariant 1; physical separation ADR-0012).

## Layout

```
compose/
  docker-compose.yml   app deployment + observability (resettable each run)
  load.yml             isolated load plane (project booklogr-edge; on-demand storm)
observability/
  prometheus.yml       scrapes booklogr-api:9090/metrics, job "booklogr-api"
  rules/booklogr-rules.yml   BooklogrApiLatencyP99High (+ error-rate, down)
  alertmanager.yml     null receiver (harness reads Prometheus directly)
  grafana/datasource.yml
instrumentation/
  apply.py             idempotent: adds prometheus-flask-exporter (multiprocess)
  README.md            what/why of the baseline metrics commit
gitea/
  ci.yml               installed to the repo as .gitea/workflows/ci.yml (build+smoke)
load/                  k6 constant-arrival-rate storm (mounted into the load plane)
scripts/
  import-substrate.sh  mirror-push upstream → Gitea, commit instrumentation + CI
  up.sh / down.sh      bring up / tear down the app stack (+ load plane)
  arm-incident.sh      regress + storm + confirm-fire (ADR-0010)
  confirm-fire.mjs     poll until BooklogrApiLatencyP99High fires (ADR-0010)
  verify-clear.mjs     sustained-clear oracle under still-active load (ADR-0004)
  status.mjs / lib.mjs current p99 + alert state; shared helpers
```

> The Gitea forge is no longer in this stack: it is **shared** infra at
> `infra/forge/` (project `sreforge-forge`), hosting one repo per use case and
> persisting across runs.

## The metric chain (kept coherent across every file)

```
flask_http_request_duration_seconds_bucket   (prometheus-flask-exporter default)
  └─ scrape job "booklogr-api" (target booklogr-api:9090/metrics)
     └─ alert BooklogrApiLatencyP99High  (rules/booklogr-rules.yml)
        └─ P99_EXPR + PRIMARY_ALERT       (scripts/lib.mjs)
           └─ MitigationOracle / PrometheusAlertProbe (core engine)
```

## Bring-up (first time)

```bash
cp .env.example .env          # fill admin password etc.

# 1. forge up (shared; run from the repo root), create admin + runner token → .env
docker compose -f infra/forge/forge.yml up -d gitea
#    (create admin via the UI at :3000 or `gitea admin user create`)
#    (runner token: repo/org/instance Settings → Actions → Runners)
docker compose -f infra/forge/forge.yml up -d act_runner

# 2. import booklogr (full history) + baseline instrumentation + CI
bash scripts/import-substrate.sh

# 3. app stack up
bash scripts/up.sh
```

## M1 verify gates (run once Docker is up)

- [ ] Prometheus scrapes `booklogr-api:9090/metrics` (target UP at :9090 → :9090/targets).
- [ ] `node scripts/status.mjs` shows a p99 number; alert rule loaded (`/rules`).
- [ ] Alert can be forced to fire (regression+load in M2, or a synthetic latency).
- [ ] Gitea Actions runs `.gitea/workflows/ci.yml` **green** on the clean baseline.
- [ ] Grafana (:3002) renders the `flask_http_request_duration_seconds` histogram.

## Not here yet (M2)

`load/` k6 storm, the deterministic slow-upstream stub service, and the authored
regression on the book-provider path. See `notes/sreforge/v1-plan.md` M2.
