---
type: spec
tags: [todo-app/phases]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Phase 4 Spec — Stand up the incident environment

> Implementation-ready spec for Phase 4 of [TEST-ENV-PLAN.md](TEST-ENV-PLAN.md). Builds the v1 Docker Compose staging stack, the Prometheus alerts that fire on injection, the fixture-lifecycle scripts (`setup.sh` / `teardown.sh` / `status.sh`), and the `latency-retry-storm` scenario end-to-end. Final state: running `scripts/setup.sh latency-retry-storm` makes the alert fire within ~6 minutes; `scripts/teardown.sh latency-retry-storm` clears it.

## Goal

End state:

1. A `docker compose` stack runs cleanly from one command and stays up between eval runs.
2. New Prometheus rules exist in `prismalens-labs/infra-docker/prometheus/rules/`:
   - `TodoApiLatencyP99High` (aggregate p99 across todo-api)
   - `TodoApiPostTodosLatencyHigh` (route-filtered p99 on POST /todos — catches latent bug A)
   - `TodoApiDeleteErrorRateHigh` (5xx rate on DELETE /todos/:id — catches latent bug B and the scripted scenario)

   All three reference `https://github.com/prismalens-labs/platform-runbooks/blob/main/general-investigation.md` as `runbookUrl`.
3. Alertmanager webhook receiver configured; URL env-driven.
4. The `prismalens-labs/infra-docker` repo exists with compose manifest, seed data, load-generator helper script.
5. Harness fixture-lifecycle scripts in `prismalens-agents-harness`:
   - Dispatchers: `scripts/setup.sh`, `scripts/teardown.sh`, `scripts/status.sh`
   - Per-scenario: `scripts/scenarios/latency-retry-storm/{setup,teardown,verify}.sh`
   - Libraries: `scripts/lib/{load-generator.sh,cleanup-fork.sh}`
6. Scenario YAML: `scenarios/latency-retry-storm.yaml`
7. JSON contract documented in `internal-docs/eval-contract.md`.
8. Smoke test passes: setup → alerts fire → verify=0 → teardown → alerts clear.

The agent visible to outside observers is unchanged: `todo-api`, `todo-web`, `infra-k8s`, `infra-docker`, `platform-runbooks`. The harness orchestrates from outside.

## Preconditions

| Check | Command | Expected |
|---|---|---|
| Phase 3 complete | `gh api repos/prismalens-labs/todo-api -q .name` | `todo-api` |
| Runbook exists | `gh api repos/prismalens-labs/platform-runbooks/contents/general-investigation.md -q .name` | `general-investigation.md` |
| Docker Compose v2 | `docker compose version` | `v2.x` |
| `psql`, `curl`, `jq` | each `--version` | non-error |
| Local host ≥ 2 CPU / 4 GB RAM | host introspection | met |
| `PRISMALENS_LABS_AGENT_PAT` env var set | `echo $PRISMALENS_LABS_AGENT_PAT \| wc -c` | non-zero |

## Inputs

- `HARNESS_PATH = /home/sumit/sources/todo-app/prismalens-agents-harness`
- `INFRA_DOCKER_PATH = /home/sumit/sources/todo-app/infra-docker` (new clone, Task 4.1)
- `TODO_API_PATH = /home/sumit/sources/todo-app/todo-api` (from Phase 3)
- `STAGING_DB_URL` (overridable via env): `postgresql://todo:todopass@localhost:5432/tododb`

## Deliverables

### New in `prismalens-labs/infra-docker` repo

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Full staging stack |
| `.env.example` | Required env vars |
| `README.md` | Bring-up instructions |
| `prometheus/prometheus.yml` | Prometheus config |
| `prometheus/rules/alerts.yml` | All three alert rules in one file |
| `alertmanager/alertmanager.yml` | Webhook receiver config |
| `grafana/provisioning/datasources/datasources.yml` | Auto-provision Prometheus + Loki |
| `grafana/provisioning/dashboards/dashboards.yml` | Auto-provision dashboard files |
| `grafana/dashboards/todo-api.json` | Latency + error-rate + request-rate dashboard |
| `loki/local-config.yaml` | Loki local config |
| `promtail/promtail.yml` | Promtail scrape config |
| `seed/01-init.sql` | Postgres seed: ~5k todos for 50 users (smaller than original — retry-storm doesn't need 100k) |

### New in `prismalens-agents-harness`

| Path | Purpose |
|---|---|
| `scripts/setup.sh` | Dispatcher — calls per-scenario setup, emits JSON contract on stdout |
| `scripts/teardown.sh` | Dispatcher — calls per-scenario teardown, runs generic DB reset + agent-PR cleanup |
| `scripts/status.sh` | Dispatcher — prints current env state for debugging |
| `scripts/scenarios/latency-retry-storm/setup.sh` | Scenario-specific inject (run load generator) |
| `scripts/scenarios/latency-retry-storm/teardown.sh` | Scenario-specific reset (stop load) |
| `scripts/scenarios/latency-retry-storm/verify.sh` | Scenario-specific verify (alert is firing) |
| `scripts/lib/load-generator.sh` | RPS-controlled curl loop |
| `scripts/lib/cleanup-fork.sh` | Closes agent PR, deletes fork branch, deletes upstream PR via GraphQL |
| `scenarios/latency-retry-storm.yaml` | Scenario declaration |

### New internal docs

- `internal-docs/eval-contract.md` — JSON contract definition + forward-compat policy
- `internal-docs/agent-workflow.md` — PR-from-fork workflow, cleanup contract
- `internal-docs/latent-bugs.md` — Bug A and Bug B reference for the maintainer
- `internal-docs/branch-protection.md` — exact ruleset documentation

## Task list

### Task 4.1 — Create `prismalens-labs/infra-docker` repo

```bash
gh repo create prismalens-labs/infra-docker --public \
  --description "Docker Compose staging environment for the todo platform" \
  --add-readme=false
cd /home/sumit/sources/todo-app
gh repo clone prismalens-labs/infra-docker
cd infra-docker
git config user.name "SRE"
git config user.email "sre@labs.prismalens.io"
```

Branch protection is applied at end of Phase 4 after content is committed (not during, to allow the initial push).

### Task 4.2 — Author the Compose stack

Write `INFRA_DOCKER_PATH/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: tododb
      POSTGRES_USER: todo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-todopass}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./seed:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U todo -d tododb"]
      interval: 5s
      timeout: 5s
      retries: 10

  valkey:
    image: valkey/valkey:8-alpine
    ports: ["6379:6379"]
    command: valkey-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  todo-api:
    build:
      context: ../todo-api
      dockerfile: Dockerfile
    ports: ["3000:3000"]
    environment:
      NODE_ENV: staging
      DATABASE_URL: postgresql://todo:${POSTGRES_PASSWORD:-todopass}@postgres:5432/tododb
      REDIS_URL: redis://valkey:6379
      API_PORT: 3000
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  todo-web:
    build:
      context: ../todo-web
      dockerfile: Dockerfile
    ports: ["3001:3001"]
    environment:
      NEXT_PUBLIC_API_URL: http://todo-api:3000
    depends_on:
      todo-api: { condition: service_healthy }

  prometheus:
    image: prom/prometheus:v3.0.0
    ports: ["9090:9090"]
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/prometheus/rules:ro
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --web.enable-lifecycle

  alertmanager:
    image: prom/alertmanager:v0.27.0
    ports: ["9093:9093"]
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    environment:
      ALERT_WEBHOOK_URL: ${ALERT_WEBHOOK_URL:-http://host.docker.internal:8080/webhook}

  loki:
    image: grafana/loki:3.2.0
    ports: ["3100:3100"]
    volumes:
      - ./loki/local-config.yaml:/etc/loki/local-config.yaml:ro
    command: -config.file=/etc/loki/local-config.yaml

  promtail:
    image: grafana/promtail:3.2.0
    volumes:
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./promtail/promtail.yml:/etc/promtail/promtail.yml:ro
    command: -config.file=/etc/promtail/promtail.yml
    depends_on: [loki]

  grafana:
    image: grafana/grafana:11.4.0
    ports: ["3002:3000"]
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
    depends_on: [prometheus, loki]

volumes:
  pgdata:
```

**Note on builds:** `todo-api` and `todo-web` use `build:` not `image:` — they build directly from the local sibling clones at `../todo-api` and `../todo-web`. This is the Q3 decision: real build from checkout, no GHCR dependency for v1. The Compose file expects `../todo-api/Dockerfile` and `../todo-web/Dockerfile` to exist (they're part of the Phase 3 extracted content).

### Task 4.3 — Prometheus config + the three alerts

Write `INFRA_DOCKER_PATH/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - /etc/prometheus/rules/*.yml

scrape_configs:
  - job_name: todo-api
    static_configs:
      - targets: ['todo-api:3000']
    metrics_path: /metrics

  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
```

Write `INFRA_DOCKER_PATH/prometheus/rules/alerts.yml`:

```yaml
groups:
  - name: todo-api.latency
    interval: 30s
    rules:
      - alert: TodoApiLatencyP99High
        expr: |
          histogram_quantile(
            0.99,
            sum(rate(http_request_duration_seconds_bucket{job="todo-api"}[5m])) by (le)
          ) > 2
        for: 5m
        labels:
          severity: critical
          service: todo-api
        annotations:
          summary: "todo-api p99 latency above 2s"
          description: "p99 request latency for todo-api has been above 2s for 5+ minutes. Check recent deploys, DB state, and error patterns."
          runbookUrl: "https://github.com/prismalens-labs/platform-runbooks/blob/main/general-investigation.md"

      - alert: TodoApiPostTodosLatencyHigh
        expr: |
          histogram_quantile(
            0.99,
            sum(rate(http_request_duration_seconds_bucket{job="todo-api", route="/todos", method="POST"}[5m])) by (le)
          ) > 2
        for: 5m
        labels:
          severity: warning
          service: todo-api
          route: "/todos"
          method: POST
        annotations:
          summary: "POST /todos p99 latency above 2s"
          description: "p99 latency on POST /todos is high. Check request body sizes and validation paths."
          runbookUrl: "https://github.com/prismalens-labs/platform-runbooks/blob/main/general-investigation.md"

  - name: todo-api.errors
    interval: 30s
    rules:
      - alert: TodoApiDeleteErrorRateHigh
        expr: |
          (
            sum(rate(http_requests_total{job="todo-api", method="DELETE", status=~"5.."}[5m]))
            /
            clamp_min(sum(rate(http_requests_total{job="todo-api", method="DELETE"}[5m])), 0.001)
          ) > 0.05
        for: 2m
        labels:
          severity: critical
          service: todo-api
          method: DELETE
        annotations:
          summary: "DELETE /todos/:id 5xx error rate above 5%"
          description: "More than 5% of DELETE requests are returning 5xx. Likely controller-level error: malformed id, missing parse pipe, or retry storm."
          runbookUrl: "https://github.com/prismalens-labs/platform-runbooks/blob/main/general-investigation.md"
```

**Metric availability check** (per Q11 verification): `apps/api/src/metrics/metrics.service.ts` exports `http_request_duration_seconds_bucket` as a histogram with labels `method`, `route`, `status` — all three alert expressions are valid against the existing instrumentation. No code change in `todo-api` needed.

### Task 4.4 — Alertmanager config

Write `INFRA_DOCKER_PATH/alertmanager/alertmanager.yml`:

```yaml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  receiver: webhook-default

receivers:
  - name: webhook-default
    webhook_configs:
      - url: ${ALERT_WEBHOOK_URL}
        send_resolved: true
```

Write `INFRA_DOCKER_PATH/.env.example`:

```
POSTGRES_PASSWORD=todopass
# Where Alertmanager POSTs firing/resolved notifications.
# Local dev: leave default.
ALERT_WEBHOOK_URL=http://host.docker.internal:8080/webhook
```

### Task 4.5 — Grafana provisioning + dashboard

Write `INFRA_DOCKER_PATH/grafana/provisioning/datasources/datasources.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
  - name: Loki
    type: loki
    url: http://loki:3100
```

Write `INFRA_DOCKER_PATH/grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: 'default'
    folder: 'prismalens-labs'
    type: file
    options:
      path: /var/lib/grafana/dashboards
```

Write `INFRA_DOCKER_PATH/grafana/dashboards/todo-api.json` — a Grafana 11 dashboard with at least three panels: p99 latency (overall + per-route), 5xx rate (per-method), request rate (per-route). For v1, hand-rolled minimal JSON is acceptable; provision via Grafana UI later for a more polished version.

### Task 4.6 — Seed data

Write `INFRA_DOCKER_PATH/seed/01-init.sql`:

```sql
-- 50 users, 100 todos each => 5k todos. Sized for retry-storm (doesn't need 100k).
INSERT INTO todos (todo, completed, user_id, created_at, updated_at)
SELECT
  'todo item ' || s,
  s % 3 = 0,
  (s % 50) + 1,
  NOW() - (random() * interval '90 days'),
  NOW() - (random() * interval '30 days')
FROM generate_series(1, 5000) s;
```

Runs after Prisma migrations init the schema. Postgres entrypoint runs `*.sql` files in `/docker-entrypoint-initdb.d/` only on first init.

### Task 4.7 — README for `infra-docker`

Write `INFRA_DOCKER_PATH/README.md`:

```markdown
# Staging — Docker Compose

The development & pre-prod stack for the todo-api / todo-web services.

## Bring up

```bash
cp .env.example .env
docker compose up -d
```

Wait ~30s for healthchecks. Services:

| Service | URL |
|---|---|
| todo-web | http://localhost:3001 |
| todo-api | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3002 (anonymous viewer) |
| Loki | http://localhost:3100 |

## Reset state

```bash
docker compose down -v   # drops the pgdata volume; seeds re-run on next up
```
```

Commit + push the whole `infra-docker` repo as `sre`:

```
feat: initial staging stack (postgres + valkey + apps + observability)
```

### Task 4.8 — Scenario YAML

Write `HARNESS_PATH/scenarios/latency-retry-storm.yaml`:

```yaml
id: latency-retry-storm
description: |
  A burst of malformed DELETE /todos/<non-int> requests reaches a controller with
  no ParseIntPipe. Prisma raises a validation error per request. The service-layer
  withRetry wrapper retries each error 3× with exponential backoff regardless of
  error class. Effective DB load is 3× incoming; cumulative backoff latency
  pushes p99 above the 2s alert threshold within minutes.

trigger:
  type: external-load
  target: "http://localhost:3000/todos/{random_non_integer}"
  method: DELETE
  rps: 50
  duration_seconds: 600

expected_alerts:
  - name: TodoApiDeleteErrorRateHigh
    fires_within_seconds: 180
  - name: TodoApiLatencyP99High
    fires_within_seconds: 360

artifacts:
  - kind: prometheus_alert
    name: TodoApiDeleteErrorRateHigh
    state: firing
  - kind: prometheus_alert
    name: TodoApiLatencyP99High
    state: firing

reset:
  type: stop-load
  description: |
    Kill the load generator. No code state to revert. DB reset to seed is
    handled by the generic teardown step in scripts/teardown.sh.
```

### Task 4.9 — Setup script (dispatcher + scenario-specific)

Write `HARNESS_PATH/scripts/setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

scenario="${1:?usage: setup.sh <scenario-id>}"
config="${HARNESS_ENV_CONFIG:-$(dirname "$0")/../harness/env-config.yaml}"
test -f "$config" || { echo "env-config not found: $config" >&2; exit 2; }

dir="$(dirname "$0")/scenarios/$scenario"
test -x "$dir/setup.sh" || { echo "no setup.sh for $scenario" >&2; exit 2; }

# Run scenario-specific setup; it must print scenario-specific JSON to stdout
scenario_json="$("$dir/setup.sh")"

# Construct agent_context.services from env-config.yaml
# Combine with scenario_json and eval_only fields per eval-contract.md
# Emit final JSON to stdout
exec "$(dirname "$0")/lib/build-contract-json.sh" \
  "$config" \
  "$scenario" \
  "$scenario_json"
```

Write `HARNESS_PATH/scripts/scenarios/latency-retry-storm/setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HARNESS_PATH="${HARNESS_PATH:-/home/sumit/sources/todo-app/prismalens-agents-harness}"
PROM_URL="${PROMETHEUS_URL:-http://localhost:9090}"
RUN_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)-$(uuidgen | cut -c1-6)"

# Start background load generator
"$HARNESS_PATH/scripts/lib/load-generator.sh" \
  --target "http://localhost:3000/todos/RANDOMIZE" \
  --method DELETE \
  --rps 50 \
  --duration 600 \
  --pid-file "/tmp/loadgen-latency-retry-storm.pid" \
  > /tmp/loadgen-latency-retry-storm.log 2>&1 &
disown

# Write deploy receipt (Q3 principle 3)
mkdir -p "$HARNESS_PATH/.harness-state/deploys/latency-retry-storm"
cat > "$HARNESS_PATH/.harness-state/deploys/latency-retry-storm/$RUN_ID.json" <<EOF
{
  "scenario": "latency-retry-storm",
  "run_id": "$RUN_ID",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit_sha": null,
  "topology": "local-docker"
}
EOF

# Emit scenario_metadata + eval_only JSON fragment (caller wraps with agent_context)
cat <<EOF
{
  "scenario": {
    "id": "latency-retry-storm",
    "class": "scripted",
    "run_id": "$RUN_ID",
    "expected_alert": "TodoApiLatencyP99High",
    "alert_fired_at": null
  },
  "eval_only": {
    "alert_to_clear": "TodoApiLatencyP99High",
    "max_clear_time_seconds": 600
  }
}
EOF
```

Note: this setup script exits immediately (does NOT block waiting for the alert to fire — per Q4 decision A). The consumer is responsible for polling Prometheus or waiting before invoking the agent.

Write `HARNESS_PATH/scripts/lib/load-generator.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

url="" method="GET" rps=10 duration=60 pid_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) url="$2"; shift 2 ;;
    --method) method="$2"; shift 2 ;;
    --rps) rps="$2"; shift 2 ;;
    --duration) duration="$2"; shift 2 ;;
    --pid-file) pid_file="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done

# Record PID for teardown
[[ -n "$pid_file" ]] && echo $$ > "$pid_file"

sleep_ms=$(( 1000 / rps ))
end=$(( $(date +%s) + duration ))

while [[ $(date +%s) -lt $end ]]; do
  # Substitute RANDOMIZE in the url with a random non-integer string
  random_token=$(tr -dc 'a-z' </dev/urandom | head -c 8)
  target="${url//RANDOMIZE/$random_token}"
  curl -s -o /dev/null -X "$method" "$target" &
  python3 -c "import time; time.sleep($sleep_ms / 1000)"
done
wait
```

### Task 4.10 — Teardown script

Write `HARNESS_PATH/scripts/teardown.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

scenario="${1:?usage: teardown.sh <scenario-id> [--hard]}"
hard_reset="false"
[[ "${2:-}" == "--hard" ]] && hard_reset="true"

dir="$(dirname "$0")/scenarios/$scenario"
test -x "$dir/teardown.sh" || { echo "no teardown.sh for $scenario" >&2; exit 2; }

# 1. Scenario-specific teardown (stop load, etc.)
"$dir/teardown.sh"

# 2. Generic DB reset (per Q7 sub-decision B option 2)
if [[ "$hard_reset" == "true" ]]; then
  # Nuclear option: drop the pgdata volume
  (cd /home/sumit/sources/todo-app/infra-docker && docker compose down -v && docker compose up -d)
else
  # Default: DROP DATABASE + CREATE DATABASE + re-run seeds
  psql "${ADMIN_DB_URL:-postgresql://todo:todopass@localhost:5432/postgres}" \
    -c "DROP DATABASE IF EXISTS tododb;" \
    -c "CREATE DATABASE tododb OWNER todo;"
  cd /home/sumit/sources/todo-app/todo-api && npx prisma migrate deploy
  psql "${STAGING_DB_URL:-postgresql://todo:todopass@localhost:5432/tododb}" \
    < /home/sumit/sources/todo-app/infra-docker/seed/01-init.sql
fi

# 3. Agent PR/fork cleanup
"$(dirname "$0")/lib/cleanup-fork.sh" "$scenario"
```

Write `HARNESS_PATH/scripts/scenarios/latency-retry-storm/teardown.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Stop the load generator
pid_file="/tmp/loadgen-latency-retry-storm.pid"
if [[ -f "$pid_file" ]]; then
  pid="$(cat "$pid_file")"
  kill "$pid" 2>/dev/null || true
  rm -f "$pid_file"
fi

# Belt-and-suspenders: kill any orphaned curl loops targeting our URL
pkill -f "curl.*localhost:3000/todos/" || true

echo "scenario-teardown: latency-retry-storm load stopped"
```

Write `HARNESS_PATH/scripts/lib/cleanup-fork.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

scenario="${1:?usage: cleanup-fork.sh <scenario-id>}"
state_dir="$(dirname "$0")/../../.harness-state"

# Use the agent bot's PAT
export GH_TOKEN="${PRISMALENS_LABS_AGENT_PAT:?PRISMALENS_LABS_AGENT_PAT not set}"

# Find PRs opened by the bot, close + delete branch + delete upstream PR record
prs=$(gh pr list -R prismalens-labs/todo-api --author "prismalens-labs-agent" --state open --json number,headRefName,id -q '.[]')

echo "$prs" | jq -c '.' | while read -r pr; do
  num=$(echo "$pr" | jq -r '.number')
  branch=$(echo "$pr" | jq -r '.headRefName')
  node_id=$(echo "$pr" | jq -r '.id')

  # Op 1: close PR + delete fork branch
  gh pr close --repo prismalens-labs/todo-api --delete-branch "$num" || true

  # Op 2: delete upstream PR record via GraphQL (admin scope required — use Sumit's PAT)
  GH_TOKEN="${SUMIT_ADMIN_PAT:-$GH_TOKEN}" gh api graphql \
    -f query='mutation($id: ID!) { deletePullRequest(input: {pullRequestId: $id}) { repository { id } } }' \
    -F id="$node_id" || true
done

# Op 3: every Nth run, wipe and recreate the fork
counter_file="$state_dir/run-counter.txt"
mkdir -p "$state_dir"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

if (( count % 10 == 0 )); then
  echo "Reached run #$count — wiping and recreating fork for clean state"
  gh repo delete prismalens-labs-agent/todo-api --yes
  gh repo fork prismalens-labs/todo-api --org prismalens-labs-agent --clone=false --remote=false
fi
```

### Task 4.11 — Verify script

Write `HARNESS_PATH/scripts/status.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PROM_URL="${PROMETHEUS_URL:-http://localhost:9090}"

echo "=== Prometheus alerts ==="
curl -s "$PROM_URL/api/v1/alerts" | jq '.data.alerts[] | {alertname: .labels.alertname, state}'

echo "=== Docker Compose services ==="
(cd /home/sumit/sources/todo-app/infra-docker && docker compose ps --format json | jq -r '"\(.Name)\t\(.State)\t\(.Health)"')

echo "=== Active scenarios ==="
ls /tmp/loadgen-*.pid 2>/dev/null || echo "(none)"
```

Write `HARNESS_PATH/scripts/scenarios/latency-retry-storm/verify.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PROM_URL="${PROMETHEUS_URL:-http://localhost:9090}"

errors=()

# Check 1: load generator is running
pid_file="/tmp/loadgen-latency-retry-storm.pid"
if [[ ! -f "$pid_file" ]] || ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  errors+=("load generator not running")
fi

# Check 2: at least one expected alert is firing
alert_states=$(curl -s "$PROM_URL/api/v1/alerts" \
  | jq -r '.data.alerts[] | select(.labels.alertname=="TodoApiLatencyP99High" or .labels.alertname=="TodoApiDeleteErrorRateHigh") | .state')

if ! echo "$alert_states" | grep -q "firing"; then
  errors+=("no expected alert firing; states observed: $alert_states")
fi

if [[ ${#errors[@]} -eq 0 ]]; then
  echo "OK: latency-retry-storm scenario is active"
  exit 0
else
  printf "FAIL:\n"
  printf "  - %s\n" "${errors[@]}"
  exit 1
fi
```

### Task 4.12 — Smoke test

Procedure:

1. Bring up stack:
   ```bash
   cd /home/sumit/sources/todo-app/infra-docker
   cp .env.example .env
   docker compose up -d
   ```
2. Wait until `docker compose ps` shows healthy services.
3. Baseline: `./scripts/verify.sh latency-retry-storm` should exit **non-zero**.
4. Setup:
   ```bash
   cd /home/sumit/sources/todo-app/prismalens-agents-harness
   ./scripts/setup.sh latency-retry-storm
   ```
   (Prints JSON contract to stdout, returns immediately.)
5. Wait ~3 minutes (DeleteErrorRateHigh fires first) or ~6 minutes (LatencyP99High fires second).
6. Verify: `./scripts/verify.sh latency-retry-storm` should exit **0**.
7. Browse Prometheus UI: http://localhost:9090/alerts — both alerts firing.
8. Teardown:
   ```bash
   ./scripts/teardown.sh latency-retry-storm
   ```
9. Wait ~5-10 min for alerts to clear.
10. Verify: `./scripts/verify.sh latency-retry-storm` should exit **non-zero**.

## Phase 4 — Definition of Done (rollup)

```bash
# Files exist
gh api repos/prismalens-labs/infra-docker -q .name
test -f /home/sumit/sources/todo-app/infra-docker/docker-compose.yml
test -f /home/sumit/sources/todo-app/infra-docker/prometheus/rules/alerts.yml
test -f /home/sumit/sources/todo-app/prismalens-agents-harness/scenarios/latency-retry-storm.yaml
test -x /home/sumit/sources/todo-app/prismalens-agents-harness/scripts/setup.sh
test -x /home/sumit/sources/todo-app/prismalens-agents-harness/scripts/teardown.sh
test -x /home/sumit/sources/todo-app/prismalens-agents-harness/scripts/status.sh
test -x /home/sumit/sources/todo-app/prismalens-agents-harness/scripts/scenarios/latency-retry-storm/setup.sh

# Stack starts
cd /home/sumit/sources/todo-app/infra-docker && docker compose up -d
sleep 60
test "$(docker compose ps --format json | jq -s '[.[] | select(.Health == "healthy")] | length')" -ge 3

# Smoke test passes
cd /home/sumit/sources/todo-app/prismalens-agents-harness
./scripts/verify.sh latency-retry-storm; test $? -ne 0   # baseline: not active
./scripts/setup.sh latency-retry-storm > /tmp/contract.json
jq -e '.scenario.id == "latency-retry-storm"' /tmp/contract.json
sleep 420                                                # 7 min — buffer past 5-min alert eval
./scripts/verify.sh latency-retry-storm                  # → exit 0
./scripts/teardown.sh latency-retry-storm
sleep 420
./scripts/verify.sh latency-retry-storm; test $? -ne 0   # cleared
```

## Idempotency notes

- `setup.sh` runs fresh load generators; running while a previous instance is active spawns a parallel one. Run `teardown.sh` first.
- `teardown.sh` is fully idempotent (uses `kill || true`, no-ops on missing state).
- `verify.sh` is read-only.
- `docker compose down -v` followed by `up -d` is the nuclear reset.

## Escalation triggers

- Stack healthchecks don't pass within 90s — likely image-pull failure or port collision.
- Alerts never fire despite load — verify `http_request_duration_seconds_bucket` series exists in Prometheus (`curl localhost:9090/api/v1/label/__name__/values | jq | grep duration_seconds`). If missing, todo-api isn't being scraped or isn't exporting metrics.
- Teardown doesn't clear alerts — Prometheus is still seeing recent data points. Wait full 10 min or restart todo-api.
- `psql` connection refused — postgres healthcheck not passing; `docker compose logs postgres`.

## Out of scope for Phase 4

- K8s topology (deferred to v2)
- Second scripted scenario (deferred to v2)
- AWS-shaped incidents / Floci (deferred to v2)
- Kamal VM topology (deferred to v3)
- Real Loki log shipping configuration tuning (Promtail is wired but may need per-host path adjustments)
- UI-driven trigger automation for latent bugs A and B (the eval framework supplies Playwright; out of harness scope)
