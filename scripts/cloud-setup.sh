#!/bin/bash
# Claude Code cloud-session bootstrap — no-op outside cloud VMs.
# Repo-side half of the cloud setup; Sumit1993/mage-memory#175 tracks the
# gaps this works around (capture hooks stay unavailable in cloud for now).
set -u
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

command -v gh >/dev/null 2>&1 || { apt-get update -qq >/dev/null && apt-get install -y -qq gh >/dev/null; } || true
command -v mage >/dev/null 2>&1 || npm install -g mage-memory@latest >/dev/null 2>&1 || true

# The mage KB is external (hub: prismalens/sreforge-kb); clone it to the
# derived hub location so the CLI resolves the docs root. Read path only:
# the cloud git proxy can push nothing but the session branch.
HUB_DIR="${MAGE_HOME:-$HOME/.mage}/hubs/github.com/prismalens/sreforge-kb"
if [ ! -e "$HUB_DIR/.git" ]; then
  mkdir -p "$(dirname "$HUB_DIR")"
  git clone --depth 1 https://github.com/prismalens/sreforge-kb.git "$HUB_DIR" \
    || echo "cloud-setup: hub clone FAILED — do not capture mage notes this session; they would silently land in the repo KB (Sumit1993/mage-memory#158)" >&2
fi
exit 0
