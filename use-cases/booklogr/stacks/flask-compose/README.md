# booklogr — flask-compose stack

The harness-side overlay that turns the imported **booklogr** substrate into a
lived-in, observable deployment with a local Git forge (CI/CD) and a load
driver. Mirrors the proven `todo-app/stacks/node-compose` layout, repointed to
booklogr's Flask/Postgres stack (D14/D15).

> The booklogr app itself is **not** in this tree. It's imported into the local
> Gitea forge and checked out (gitignored) at `substrate/booklogr` as the build
> context. The observability/load/CI overlay lives here, in the harness, never
> inside the substrate repo (build-invariant 1; physical separation D12).

## Layout

```
compose/
  docker-compose.yml   app deployment + observability (resettable each run)
  forge.yml            Gitea + act_runner (long-lived; holds the repo)
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
  runner-config.yaml   act_runner: run ubuntu-latest jobs on the host (docker build)
load/                  k6 constant-arrival-rate storm (M2)
scripts/
  import-substrate.sh  mirror-push upstream → Gitea, commit instrumentation + CI
  up.sh / down.sh      bring up / tear down the app stack
  confirm-fire.mjs     poll until BooklogrApiLatencyP99High fires (D10)
  verify-clear.mjs     sustained-clear oracle under still-active load (D4)
  status.mjs / lib.mjs current p99 + alert state; shared helpers
```

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

# 1. forge up, create admin user, generate a runner token → put it in .env
docker compose -f compose/forge.yml up -d gitea
#    (create admin via the UI at :3000 or `gitea admin user create`)
#    (runner token: repo/org/instance Settings → Actions → Runners)
docker compose -f compose/forge.yml up -d act_runner

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
