#!/usr/bin/env bash
# =============================================================================
# quiesce.sh — quiesce gate before arm (#74 / ADR-0010)
#
# Makes the observability plane a constant at t=0 by:
# 1. Stopping any active load (edge-client)
# 2. Force-recreating Prometheus + Alertmanager to wipe carryover TSDB state
# 3. Optionally running a fixed-duration warm-up baseline (if QUIESCE_WARMUP_S > 0)
# 4. Asserting 0 firing/pending alerts, targets up, and baseline metrics present
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"
. "$HERE/lib-deploy.sh"   # neutral DEPLOY_DIR + COMPOSE_FILE/LOAD_FILE

QUIESCE_WARMUP_S="${QUIESCE_WARMUP_S:-0}"

# 1. Stop all storm/load clients
echo "==> Quiescing load (stopping edge-client)..."
docker stop edge-client >/dev/null 2>&1 || true

# 2. Recreate Prometheus + Alertmanager to wipe carryover TSDB + alert state
echo "==> Recreating Prometheus and Alertmanager to wipe carryover TSDB state..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate prometheus alertmanager

# 3. Warm-up (only if QUIESCE_WARMUP_S > 0)
if [ "$QUIESCE_WARMUP_S" -gt 0 ]; then
  echo "==> Running baseline warm-up storm for ${QUIESCE_WARMUP_S}s..."
  docker compose -p booklogr-edge -f "$LOAD_FILE" up -d --force-recreate
  sleep "$QUIESCE_WARMUP_S"
  echo "==> Stopping warm-up storm..."
  docker stop edge-client >/dev/null 2>&1 || true
fi

# 4. Assert quiesced
echo "==> Confirming observability plane is quiesced..."
exec node "$SCRIPTS/confirm-quiesced.mjs" "$@"
