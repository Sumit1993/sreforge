#!/usr/bin/env bash
# =============================================================================
# agent-reference.sh — deterministic AGENT_CMD for the automated cycle (③).
#
# Applies the scenario's reference fix inside the sandbox and runs `submit` —
# the auto path's analog of smoke-positive.sh: it proves the pipeline
# (alert push → driver → in-box edit → submit → grade) end-to-end with no
# model in the loop, so it needs NO provider egress (runs under the sealed
# zero-egress default).
#
#   pnpm forge auto booklogr AGENT_CMD='bash scripts/agent-reference.sh'
#
# auto-incident.mjs invokes AGENT_CMD host-side (cwd = the stack dir) with the
# delivered notification in WEBHOOK_PAYLOAD; a real driver reasons from it,
# this one only reports it arrived.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"    # = stacks/flask-compose/scripts
PATCH="$HERE/../../../scenarios/latency-cache-stampede/solution/fix.patch"
[ -f "$PATCH" ] || { echo "agent-reference: no reference fix at $PATCH" >&2; exit 1; }

if [ -n "${WEBHOOK_PAYLOAD:-}" ]; then
  echo "agent-reference: webhook payload delivered ($(printf '%s' "$WEBHOOK_PAYLOAD" | wc -c) bytes)"
else
  echo "agent-reference: WARN — no WEBHOOK_PAYLOAD in env (manual invocation?)" >&2
fi

# All agent actions are execs into the box, as the NON-root agent user.
U="$(id -u):$(id -g)"
docker exec -i -u "$U" -w /workspace agent-shell sh -c 'git apply' < "$PATCH"
echo "agent-reference: reference fix applied in /workspace"
docker exec -u "$U" -w /workspace agent-shell submit "Restore an effective search-response cache"
