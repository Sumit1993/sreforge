#!/usr/bin/env bash
# Bring up the booklogr app deployment + observability overlay (the resettable
# stack). The shared forge (infra/forge/forge.yml) is brought up separately and persists.
# Requires the substrate to have been imported (substrate/booklogr present).
#
# Load plane (edge-client / k6) is NOT started here — load is arm's concern.
# After a host reboot edge-client sits Exited(255); if we restart it now its
# traffic will saturate the cold API's gunicorn workers before the healthcheck
# passes (the same race arm-incident.sh already guards against). Stop it first,
# then bring up app + observability clean.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
cd "$STACK"
. "$HERE/lib-deploy.sh"   # neutral DEPLOY_DIR + COMPOSE_FILE (de-tell; see lib-deploy.sh)

[ -d substrate/booklogr ] || { echo "substrate/booklogr missing — run scripts/import-substrate.sh first"; exit 1; }

# Quiesce any lingering load plane BEFORE the app comes up (mirrors arm-incident.sh).
# After a host reboot edge-client sits Exited(255); docker compose up would
# restart it instantly, hammering the cold API and blocking the healthcheck.
docker stop edge-client >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" up -d --build
echo "waiting for booklogr-api to report healthy…"
docker compose -f "$COMPOSE_FILE" ps
echo
echo "  API:        http://localhost:5000/"
echo "  Web:        http://localhost:5150/"
echo "  Prometheus: http://localhost:9090/"
echo "  Alertmgr:   http://localhost:9093/"
echo "  Grafana:    http://localhost:3002/"
echo
echo "  Load plane (edge-client) NOT started — it is arm's concern."
echo "  Next: pnpm forge arm booklogr"
