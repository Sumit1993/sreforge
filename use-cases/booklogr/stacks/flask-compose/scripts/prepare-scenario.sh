#!/usr/bin/env bash
# Prepare the local anchor for a scenario using fault_delivery_arm_deploy_recent
# (mode 2). Idempotent setup-time step: creates a local branch (BASELINE_REF)
# pointing to ANCHOR_BASE_REF. Never pushed to origin.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
. "$HERE/lib-scenario.sh"

SCENARIO_ID="${1:?usage: prepare-scenario.sh <scenario-id>}"
WORK="$STACK/substrate/booklogr"
[ -d "$WORK/.git" ] || { echo "substrate not found at $WORK — run import-substrate.sh first" >&2; exit 1; }

# Scenarios with authored anchor state (e.g. decoy-deploy-control's backdated
# "old code" commits) ship their own prepare-<scenario-id>-base.sh. Dispatch to
# it instead of the generic branch-at-ANCHOR_BASE_REF path below — otherwise a
# substrate rebuild followed by a generic prepare silently creates an anchor
# missing that authored state (#96).
SCENARIO_PREP="$HERE/prepare-${SCENARIO_ID}-base.sh"
if [ -f "$SCENARIO_PREP" ]; then
  exec bash "$SCENARIO_PREP"
fi

source_scenario_env "$SCENARIO_ID"
: "${BASELINE_REF:?scenario.env for $SCENARIO_ID must set BASELINE_REF}"
: "${ANCHOR_BASE_REF:?scenario.env for $SCENARIO_ID must set ANCHOR_BASE_REF}"

git -C "$WORK" fetch origin --prune --quiet
if git -C "$WORK" show-ref --verify --quiet "refs/heads/$BASELINE_REF"; then
  echo "anchor '$BASELINE_REF' already prepared for $SCENARIO_ID -> $(git -C "$WORK" rev-parse "$BASELINE_REF")"
else
  git -C "$WORK" branch "$BASELINE_REF" "$ANCHOR_BASE_REF"
  echo "prepared scenario '$SCENARIO_ID': local anchor '$BASELINE_REF' -> $(git -C "$WORK" rev-parse "$BASELINE_REF") (host-side only; never pushed to origin)"
fi
