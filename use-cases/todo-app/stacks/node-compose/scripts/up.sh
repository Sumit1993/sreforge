#!/usr/bin/env bash
# Build + start the node-compose stack, then wait until the API is healthy and
# Prometheus is scraping it. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."   # node-compose harness dir
REPO_ROOT="$(git rev-parse --show-toplevel)"
OPS="$(cd "$REPO_ROOT/.." && pwd)/prismalens-labs/todo-app-ops"
COMPOSE="docker compose -f $OPS/compose/docker-compose.yml"

echo "==> building + starting stack"
$COMPOSE up -d --build

echo "==> waiting for api to become healthy"
for i in $(seq 1 60); do
  cid="$($COMPOSE ps -q api || true)"
  st="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
  echo "    api: ${st} (${i})"
  [ "$st" = "healthy" ] && break
  [ "$st" = "unhealthy" ] && { echo "api unhealthy — logs:"; $COMPOSE logs --tail=40 api; exit 1; }
  sleep 2
done
[ "${st:-}" = "healthy" ] || { echo "ERROR: api did not become healthy in time"; $COMPOSE logs --tail=40 api; exit 1; }

echo "==> waiting for prometheus to scrape todo-app-api (up==1)"
for i in $(seq 1 30); do
  up="$(node -e "fetch('http://localhost:9090/api/v1/query?query='+encodeURIComponent('up{job=\"todo-app-api\"}')).then(r=>r.json()).then(j=>{const v=j.data.result?.[0]?.value?.[1];process.stdout.write(v||'0')}).catch(()=>process.stdout.write('0'))" 2>/dev/null || echo 0)"
  echo "    up{todo-app-api}=${up} (${i})"
  [ "$up" = "1" ] && break
  sleep 2
done
[ "${up:-}" = "1" ] || { echo "ERROR: prometheus never scraped todo-app-api (up != 1)"; exit 1; }

echo "==> stack ready:"
echo "    API         http://localhost:3000/api  (health /api/health)"
echo "    Prometheus  http://localhost:9090"
echo "    Alertmanager http://localhost:9093"
echo "    Grafana     http://localhost:3002"
