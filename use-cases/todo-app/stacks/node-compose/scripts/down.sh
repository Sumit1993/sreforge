#!/usr/bin/env bash
# Tear down the node-compose stack. Pass --wipe to also drop volumes (DB data).
set -euo pipefail
cd "$(dirname "$0")/.."   # node-compose root
COMPOSE="docker compose -f compose/docker-compose.yml"
if [ "${1:-}" = "--wipe" ]; then
  echo "==> down + volumes"
  $COMPOSE down -v
else
  echo "==> down (keeping volumes)"
  $COMPOSE down
fi
