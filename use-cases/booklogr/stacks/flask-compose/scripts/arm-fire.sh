#!/usr/bin/env bash
# =============================================================================
# arm-fire.sh — arm PHASE 2 of 2: re-apply load to the regressed baseline and
# confirm the alert fires (ADR-0010 gate). Assumes arm-regress.sh already ran
# (substrate regressed, booklogr-api healthy, load quiesced).
#
# Split out of arm-incident.sh for the auto-incident ordering fix (#22): under
# automation this phase must run AFTER the box + in-box webhook listener are up,
# so the Alertmanager push that firing triggers is actually caught. The manual
# path is unaffected — arm-incident.sh runs arm-regress.sh then this.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"
. "$HERE/lib-deploy.sh"   # neutral DEPLOY_DIR + COMPOSE_FILE/LOAD_FILE (de-tell)
. "$HERE/lib-scenario.sh"

SCENARIO_ID="${SCENARIO_ID:-latency-cache-stampede}"
source_scenario_env "$SCENARIO_ID"

# 5. Ensure the storm is running (on-demand load profile)
echo "==> Ensuring the load storm is running (edge-client)..."
docker compose -p booklogr-edge -f "$LOAD_FILE" up -d --force-recreate

# 6. Confirm the alert fires (ADR-0010 gate)
echo "==> Waiting for alert to fire (timeout=240s)..."
node "$SCRIPTS/confirm-fire.mjs" --timeout=240 --alert="${ALERT}"

# 7. Done
echo "==> armed: incident is live (alert firing under active load)"
