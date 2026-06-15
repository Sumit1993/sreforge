#!/usr/bin/env bash
# Tear down the booklogr app deployment + observability (the resettable stack)
# and the load plane, including volumes. Leaves the shared forge
# (infra/forge/forge.yml) running.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
cd "$STACK"
docker compose -p booklogr-edge -f compose/load.yml down 2>/dev/null || true
docker compose -f compose/docker-compose.yml down -v "$@"
