#!/usr/bin/env bash
# =============================================================================
# arm-regress.sh — arm PHASE 1 of 2: regress the substrate + forge and bring the
# regressed app up healthy, but DO NOT fire the alert yet (load stays quiesced).
#
# Split out of arm-incident.sh for the auto-incident ordering fix (#22): the
# per-run /workspace clone (prepare-agent-workspace.sh) reads the LOCAL substrate
# at its current HEAD, so the substrate must be regressed BEFORE the clone. In
# modes 2/3 the fault is applied DURING arm (fault_delivery_arm_*), so a clone
# taken before arm carries a stale base-sha and the external-agent-runner
# base-sha assert fails. Running this phase first makes the clone match the armed
# head; the fire phase (arm-fire.sh) then runs after the box + listener are up.
#
# The manual path is unaffected: arm-incident.sh runs this then arm-fire.sh, so
# `task arm` behaves exactly as before.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"
REPO_ROOT="$(cd "$STACK/../../../.." && pwd)"
. "$HERE/lib-deploy.sh"   # neutral DEPLOY_DIR + COMPOSE_FILE/LOAD_FILE (de-tell)
. "$HERE/lib-scenario.sh"
. "$HERE/lib-fault-delivery.sh"

SCENARIO_ID="${SCENARIO_ID:-latency-cache-stampede}"
source_scenario_env "$SCENARIO_ID"

# 1. Guard: substrate must be imported
echo "==> Checking substrate workspace..."
if [ ! -d "$STACK/substrate/booklogr/.git" ]; then
  echo "ERROR: substrate not found at $STACK/substrate/booklogr — run import-substrate.sh first" >&2
  exit 1
fi

# 1b. Prune leftover per-run fix branches (local + forge) so the history an
# agent clones — and the contamination-guard's `git log --all` — stays clean.
echo "==> Pruning leftover fix/* branches..."
WORK="$STACK/substrate/booklogr"
for ref in $(git -C "$WORK" ls-remote --heads origin 'fix/*' 2>/dev/null | awk '{print $2}'); do
  git -C "$WORK" push origin --delete "${ref#refs/heads/}" >/dev/null 2>&1 || true
done
for lb in $(git -C "$WORK" for-each-ref --format='%(refname:short)' 'refs/heads/fix/*' 2>/dev/null); do
  git -C "$WORK" branch -D "$lb" >/dev/null 2>&1 || true
done

# 2. Re-regress the forge default branch (reset main to the immutable regressed
#    anchor). The scenario's anchor is a LOCAL branch — never published to origin
#    (see import-substrate.sh) — so we push it straight onto origin/main; the
#    agent-visible forge never shows a tell-tale anchor branch.
echo "==> Re-regressing forge: resetting origin/main from the local anchor ($BASELINE_REF)..."
# 3. Reset the local workspace onto the regressed anchor on a clean main
echo "==> Resetting local workspace to the anchor ($BASELINE_REF)..."

# Always clear any leftover runtime-env override from a prior arm-runtime-notrace
# scenario (mode 3) BEFORE arming THIS scenario — a decoy override must never
# leak into another scenario's incident. Modes 1/2 always run with a clean
# override; mode 3 re-writes it fresh below.
ENV_OVERRIDE_FILE="$(dirname "$COMPOSE_FILE")/.env"
rm -f "$ENV_OVERRIDE_FILE"
: "${DELIVERY_MODE:?scenario.env for $SCENARIO_ID must set DELIVERY_MODE}"
: "${BASELINE_REF:?scenario.env for $SCENARIO_ID must set BASELINE_REF}"
case "$DELIVERY_MODE" in
  setup-baked)
    fault_delivery_setup_baked "$STACK/substrate/booklogr" "$BASELINE_REF"
    ;;
  arm-deploy-recent)
    : "${FAULT_PATCH:?scenario.env for $SCENARIO_ID must set FAULT_PATCH}"
    : "${COMMIT_MESSAGE:?scenario.env for $SCENARIO_ID must set COMMIT_MESSAGE}"
    : "${AUTHOR_NAME:?scenario.env for $SCENARIO_ID must set AUTHOR_NAME}"
    : "${AUTHOR_EMAIL:?scenario.env for $SCENARIO_ID must set AUTHOR_EMAIL}"
    if [ -n "${SEED_COUNT:-}" ]; then
      bash "$SCRIPTS/seed-library.sh" "$SEED_COUNT"
    fi
    fault_delivery_arm_deploy_recent "$STACK/substrate/booklogr" "$BASELINE_REF" \
      "$REPO_ROOT/$FAULT_PATCH" "$COMMIT_MESSAGE" "$AUTHOR_NAME" "$AUTHOR_EMAIL"
    ;;
  arm-runtime-notrace)
    : "${FAULT_PATCH:?scenario.env for $SCENARIO_ID must set FAULT_PATCH}"
    : "${COMMIT_MESSAGE:?scenario.env for $SCENARIO_ID must set COMMIT_MESSAGE}"
    : "${AUTHOR_NAME:?scenario.env for $SCENARIO_ID must set AUTHOR_NAME}"
    : "${AUTHOR_EMAIL:?scenario.env for $SCENARIO_ID must set AUTHOR_EMAIL}"
    : "${RUNTIME_ENV_VAR:?scenario.env for $SCENARIO_ID must set RUNTIME_ENV_VAR}"
    : "${RUNTIME_ENV_VALUE:?scenario.env for $SCENARIO_ID must set RUNTIME_ENV_VALUE}"
    fault_delivery_arm_runtime_notrace "$STACK/substrate/booklogr" "$BASELINE_REF" \
      "$REPO_ROOT/$FAULT_PATCH" "$COMMIT_MESSAGE" "$AUTHOR_NAME" "$AUTHOR_EMAIL" \
      "$ENV_OVERRIDE_FILE" "$RUNTIME_ENV_VAR" "$RUNTIME_ENV_VALUE"
    ;;
  *)
    echo "ERROR: unknown DELIVERY_MODE '$DELIVERY_MODE' for scenario '$SCENARIO_ID'" >&2
    exit 1
    ;;
esac

# 3b. Quiesce any in-flight load BEFORE bringing up the regressed baseline.
# Deploying a NullCache build straight into an active storm saturates all four
# gunicorn workers on the slow upstream, so even the GET / healthcheck (3s
# timeout) can never get a free worker and the container never reports healthy.
# The incident is established by APPLYING load to a healthy baseline, not by
# booting the baseline under load — so stop the storm, settle, then re-apply it.
echo "==> Quiescing load (stop edge-client) before regressed redeploy..."
docker stop edge-client >/dev/null 2>&1 || true

# 4. Redeploy the regressed api and wait healthy (max ~90s).
# --force-recreate: on a repeat arm the regressed build is byte-identical, so
# compose would otherwise leave the RUNNING container in place — one still
# saturated by the previous storm's listen-backlog (2048 queued × 1.2s ÷ 4
# workers ≈ 10min to drain), which the 90s health gate can never outwait. A
# fresh container = a fresh (empty) socket backlog.
echo "==> Deploying regressed booklogr-api..."
docker compose -p booklogr -f "$COMPOSE_FILE" up -d --build --force-recreate booklogr-api

echo "==> Waiting for booklogr-api to become healthy (max 90s)..."
healthy=0
for i in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' booklogr-api 2>/dev/null || true)
  if [ "$s" = "healthy" ]; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "ERROR: booklogr-api did not become healthy within 90s" >&2
  exit 1
fi
echo "==> booklogr-api is healthy (regressed, load quiesced — not yet firing)"
