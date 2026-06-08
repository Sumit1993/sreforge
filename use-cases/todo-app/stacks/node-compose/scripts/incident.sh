#!/usr/bin/env bash
# End-to-end demo of the SREForge `latency-retry-storm` incident loop on the
# node-compose substrate. Mirrors the engine contract:
#
#   trigger -> confirm-fire (D10) -> [agent fix] -> CI gate -> CD redeploy
#           -> behavioural verify under still-active fault (D4) -> reset
#
# This is the operator front door for the scenario. The "agent fix" step here
# applies the reference patch; in a real run the agent edits the run workspace
# and calls `sreforge submit`. The fault load is NEVER stopped to clear the
# alert — only the deployed fix can clear it.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REPO_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel)"
SCEN="$REPO_ROOT/use-cases/todo-app/scenarios/latency-retry-storm"
PATCH="$SCEN/solution/fix.patch"
COMPOSE="docker compose -f compose/docker-compose.yml"
FILES=(apps/api/src/todos/todos.controller.ts apps/api/src/todos/todos.service.ts)
STORM_PID=""

cleanup() {
  [ -n "$STORM_PID" ] && kill "$STORM_PID" 2>/dev/null || true
  git -C "$ROOT" checkout -- "${FILES[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

log "[1/6] bring up baseline (buggy) stack"
git -C "$ROOT" checkout -- "${FILES[@]}" 2>/dev/null || true   # ensure buggy baseline
bash scripts/up.sh

log "[2/6] inject fault — malformed-DELETE retry storm (~1.5 rps, held under the rate limit, stays running)"
node load/driver.mjs --mode=storm --rps=1.5 > /tmp/sreforge-incident-storm.log 2>&1 &
STORM_PID=$!
echo "    storm pid=$STORM_PID  (log: /tmp/sreforge-incident-storm.log)"

log "[3/6] confirm-fire gate (D10): the incident must reproduce before handoff"
node scripts/confirm-fire.mjs --timeout=180

log "[4/6] fix submitted -> CI gate -> CD redeploy"
echo "    applying reference fix to the run workspace"
git -C "$ROOT" apply "$PATCH"
echo "    CI gate: nest build"
if pnpm --filter todo-app-api-nestjs build > /tmp/sreforge-ci.log 2>&1; then
  echo "    CI green"
else
  echo "    CI RED — aborting (no deploy):"; tail -20 /tmp/sreforge-ci.log; exit 1
fi
echo "    CD: rebuild + redeploy api (swap only; --no-deps leaves migrate/db untouched)"
$COMPOSE build api > /dev/null
$COMPOSE up -d --no-deps api

log "[5/6] behavioural verify (D4): alert clears & sustains under STILL-ACTIVE load"
node scripts/verify-clear.mjs --sustain=30 --timeout=180

log "[6/6] reset: stop load + restore buggy baseline (cleanup trap)"
printf '\n\033[1;32mINCIDENT LOOP PASSED \xe2\x9c\x85\033[0m\n'
echo "Stack left running. Tear down with: bash scripts/down.sh"
