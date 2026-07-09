#!/usr/bin/env bash
# agent-inbox.sh — host-side driver for the IN-BOX confinement mode.
#
# Usage:
#   AGENT_CMD="bash scripts/agent-inbox.sh" pnpm forge auto booklogr PROVIDER=ollama-cloud
#
# Tradeoff: the API credential enters the box visible to the agent; box egress
# opens to the provider; in exchange there is no docker socket and no host
# process to confine — strongest structural isolation of the three modes.
#
# AGENT_CMD contract (auto-incident.mjs): WEBHOOK_PAYLOAD env in, submit
# sentinel written in-box on success, exit 0.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load the stack .env for OLLAMA_API_KEY (same pattern as agent-ollama.mjs —
# the auto env-allowlist deliberately strips it from the agent subprocess env).
if [ -f "$HERE/../.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$HERE/../.env"; set +a
fi

: "${OLLAMA_API_KEY:?FATAL: set OLLAMA_API_KEY in the stack .env}"

MODEL="${OLLAMA_MODEL:-qwen3-coder:480b-cloud}"
PROVIDER="${PROVIDER:-ollama-cloud}"
SCRATCH="$(mktemp -d /tmp/agent-inbox.XXXXXX)"
AGENT_LOG="${AGENT_LOG:-$SCRATCH/agent-inbox-transcript.txt}"

echo "╭──────────────────────────────────────────────────────────────╮"
echo "│  confinement: in-box                                        │"
echo "│  provider:    ${PROVIDER}"
echo "│  model:       ${MODEL}"
echo "│  reasoning egress: enforced by the box firewall             │"
echo "│                    (see task agent output)                   │"
echo "╰──────────────────────────────────────────────────────────────╯"

# Key injected PER-EXEC (mirrors the EGRESS_ALLOWLIST pattern: never lands
# in container env/compose). Run as the host uid/gid so /workspace writes
# stay owner-consistent.
docker exec \
  -u "$(id -u):$(id -g)" \
  -w /workspace \
  -e OLLAMA_API_KEY="$OLLAMA_API_KEY" \
  -e OLLAMA_MODEL="${OLLAMA_MODEL:-}" \
  -e OLLAMA_HOST="${OLLAMA_HOST:-}" \
  -e MAX_STEPS="${MAX_STEPS:-}" \
  -e AGENT_WINDOW="${AGENT_WINDOW:-}" \
  -e AGENT_OUT_MAX="${AGENT_OUT_MAX:-}" \
  -e WEBHOOK_PAYLOAD="${WEBHOOK_PAYLOAD:-}" \
  agent-shell \
  node /usr/local/lib/agent-loop.mjs 2>&1 | tee "$AGENT_LOG" || true
# (|| true: under pipefail a non-zero loop exit would abort before the sentinel
# check — and the sentinel, not the loop's exit code, is the contract.)

# Sentinel check (same as agent-agy.sh)
if docker exec agent-shell sh -c 'test -f /workspace/.sreforge/submit.json'; then
  echo "agent-inbox: submit sentinel present — ready to grade. transcript: $AGENT_LOG"
  exit 0
fi
echo "agent-inbox: no submit sentinel — nothing to grade. transcript: $AGENT_LOG" >&2
exit 2
