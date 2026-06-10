#!/usr/bin/env bash
# Tear down the node-compose stack. Pass --wipe to also drop volumes (DB data).
set -euo pipefail
cd "$(dirname "$0")/.."   # node-compose harness dir
REPO_ROOT="$(git rev-parse --show-toplevel)"
OPS="$(cd "$REPO_ROOT/.." && pwd)/prismalens-labs/todo-app-ops"
COMPOSE="docker compose -f $OPS/compose/docker-compose.yml"
if [ "${1:-}" = "--wipe" ]; then
  echo "==> down + volumes"
  $COMPOSE down -v
else
  echo "==> down (keeping volumes)"
  $COMPOSE down
fi
