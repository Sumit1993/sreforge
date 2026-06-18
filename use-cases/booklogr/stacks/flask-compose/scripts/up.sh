#!/usr/bin/env bash
# Bring up the booklogr app deployment + observability overlay (the resettable
# stack). The shared forge (infra/forge/forge.yml) is brought up separately and persists.
# Requires the substrate to have been imported (substrate/booklogr present).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
cd "$STACK"
. "$HERE/lib-deploy.sh"   # neutral DEPLOY_DIR + COMPOSE_FILE (de-tell; see lib-deploy.sh)

[ -d substrate/booklogr ] || { echo "substrate/booklogr missing — run scripts/import-substrate.sh first"; exit 1; }

docker compose -f "$COMPOSE_FILE" up -d --build
echo "waiting for booklogr-api to report healthy…"
docker compose -f "$COMPOSE_FILE" ps
echo
echo "  API:        http://localhost:5000/"
echo "  Web:        http://localhost:5150/"
echo "  Prometheus: http://localhost:9090/"
echo "  Alertmgr:   http://localhost:9093/"
echo "  Grafana:    http://localhost:3002/"
