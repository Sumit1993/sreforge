#!/usr/bin/env bash
# =============================================================================
# prepare-agent-workspace.sh — produce a clean, de-tell'd agent-facing workspace.
#
# The per-run workspace the EXTERNAL agent edits (mounted at /workspace in the
# agent-sandbox, infra/agent-sandbox/agent.yml) must carry NO rig tells. The
# substrate clone's `origin` is a forge tell AND leaks a credential, e.g.:
#     http://Mozzo1000:<run-ops-token>@localhost:3000/booklogr/booklogr.git
# and it carries a host-side `baseline` reset-anchor branch. Neither may reach
# the agent.
#
# This produces exactly that clean copy: a clone of the substrate's current
# (regressed) default branch — organic history + maintainer identity + backdated
# commits KEPT (those read as a real repo) — with `origin` and `baseline`
# STRIPPED. The agent never pushes; submit is an engine handoff, so the workspace
# needs no remote at all.
#
# Usage:
#   prepare-agent-workspace.sh [SRC_SUBSTRATE] [DEST_WORKSPACE]
# Defaults:
#   SRC  = <stack>/substrate/booklogr
#   DEST = <stack>/.run-workspace/booklogr   (gitignored)
# On success prints the absolute DEST path on stdout — feed it to the sandbox as
#   WORKSPACE_DIR=$(scripts/prepare-agent-workspace.sh) \
#     docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml up -d
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"

SRC="${1:-$STACK/substrate/booklogr}"
DEST="${2:-$STACK/.run-workspace/booklogr}"

if [ ! -d "$SRC/.git" ]; then
  echo "ERROR: no substrate clone at $SRC — run import-substrate.sh + arm-incident.sh first" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"

# Local clone: brings the substrate's history + default branch. (A local clone
# only copies the source's local branches — main + baseline — as origin/* refs;
# the checkout is the default branch, i.e. the regressed main the agent investigates.)
git clone --quiet "$SRC" "$DEST"

# Strip the forge: removing origin drops the credential-bearing forge URL AND all
# origin/* remote-tracking refs (including the 'baseline' reset anchor that came
# across as origin/baseline).
git -C "$DEST" remote remove origin

# Belt-and-suspenders: delete any LOCAL 'baseline' branch, in case a future clone
# path ever carries it as a local ref.
git -C "$DEST" branch -D baseline >/dev/null 2>&1 || true

# Fail closed if either tell survived.
if git -C "$DEST" remote -v | grep -q .; then
  echo "ERROR: origin still present after strip:" >&2
  git -C "$DEST" remote -v >&2
  exit 1
fi
if git -C "$DEST" branch -a | grep -Eq '(^|[ */])baseline([ ]|$)'; then
  echo "ERROR: a 'baseline' branch survived in $DEST" >&2
  exit 1
fi

# Emit the absolute path for use as WORKSPACE_DIR.
( cd "$DEST" && pwd )
