#!/usr/bin/env bash
# Tear down the booklogr app deployment + observability (the resettable stack),
# including volumes. Leaves the forge (compose/forge.yml) running.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
cd "$STACK"
docker compose -f compose/docker-compose.yml down -v "$@"
