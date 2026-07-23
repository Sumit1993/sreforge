#!/usr/bin/env bash
# Author the decoy-deploy-control scenario base: two BACKDATED "old code" prep
# commits on top of the healthy import commit (ANCHOR_BASE_REF), then anchor
# the scenario's local branch (BASELINE_REF) at the result. Mirrors
# inject-regression.sh's authoring pattern (maintainer identity, backdated
# GIT_AUTHOR_DATE, normalized mtimes) — these are "old code", not the incident.
#
# Commit 1 — config.py: hardcoded CACHE_TYPE -> 12-factor env-read (matches
#   every neighboring os.environ.get(...) line already in that file).
# Commit 2 — app.py: a boot log line summarizing the effective cache backend
#   (plausible ops practice; also the diagnosis breadcrumb for this scenario).
#
# Idempotent: no-ops if the anchor branch already exists. Requires
# ANCHOR_BASE_REF (baseline^) to already resolve, i.e. run this AFTER
# import-substrate.sh + inject-regression.sh. Never pushes the resulting
# branch to origin — it stays a local anchor, like every other scenario's.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
. "$HERE/lib-scenario.sh"

SCENARIO_ID="decoy-deploy-control"
WORK="$STACK/substrate/booklogr"
CFG="$WORK/api/config.py"
APP="$WORK/api/app.py"

[ -d "$WORK/.git" ] || { echo "substrate not found at $WORK — run import-substrate.sh first" >&2; exit 1; }

source_scenario_env "$SCENARIO_ID"
: "${BASELINE_REF:?scenario.env for $SCENARIO_ID must set BASELINE_REF}"
: "${ANCHOR_BASE_REF:?scenario.env for $SCENARIO_ID must set ANCHOR_BASE_REF}"

git -C "$WORK" fetch origin --prune --quiet

if git -C "$WORK" show-ref --verify --quiet "refs/heads/$BASELINE_REF"; then
  echo "anchor '$BASELINE_REF' already prepared -> $(git -C "$WORK" rev-parse "$BASELINE_REF")"
  exit 0
fi

git -C "$WORK" rev-parse --verify --quiet "$ANCHOR_BASE_REF" >/dev/null \
  || { echo "ERROR: anchor base '$ANCHOR_BASE_REF' not found — run inject-regression.sh (and import-substrate.sh) first" >&2; exit 1; }

# The scratch checkout below would carry any local edits into the backdated
# commits (and lose them on restore) — refuse to run on a dirty substrate.
[ -z "$(git -C "$WORK" status --porcelain)" ] \
  || { echo "ERROR: substrate worktree at $WORK must be clean" >&2; exit 1; }

# Build on a throwaway local branch off the healthy anchor base, then fold the
# result into BASELINE_REF and restore whatever HEAD pointed at before —
# via an EXIT trap, so a failure mid-authoring (set -e) restores it too.
ORIG_REF="$(git -C "$WORK" symbolic-ref --short -q HEAD || git -C "$WORK" rev-parse HEAD)"
SCRATCH="decoy-prep-scratch"
restore() {
  status=$?
  git -C "$WORK" checkout --quiet "$ORIG_REF" || true
  git -C "$WORK" branch -D "$SCRATCH" >/dev/null 2>&1 || true
  exit "$status"
}
trap restore EXIT
git -C "$WORK" branch -f "$SCRATCH" "$ANCHOR_BASE_REF"
git -C "$WORK" checkout --quiet "$SCRATCH"

export GIT_AUTHOR_NAME="Andreas Backström" GIT_AUTHOR_EMAIL="mozzo242@gmail.com"
export GIT_COMMITTER_NAME="Andreas Backström" GIT_COMMITTER_EMAIL="mozzo242@gmail.com"

# --- commit 1: config.py -> 12-factor CACHE_TYPE -----------------------------
export GIT_AUTHOR_DATE="2026-06-15 09:12:31 +0200" GIT_COMMITTER_DATE="2026-06-15 09:12:31 +0200"
sed -i 's/    CACHE_TYPE = "SimpleCache"/    CACHE_TYPE = os.environ.get("CACHE_TYPE", "SimpleCache")/' "$CFG"
grep -q 'CACHE_TYPE = os.environ.get("CACHE_TYPE", "SimpleCache")' "$CFG" || { echo "sed anchor not found (config.py)"; exit 1; }
touch -r "$WORK/api/models.py" "$CFG"
git -C "$WORK" add -- "$CFG"
git -C "$WORK" commit -m "Read cache backend from environment" >/dev/null

# --- commit 2: app.py -> boot log line ---------------------------------------
export GIT_AUTHOR_DATE="2026-06-20 16:47:03 +0200" GIT_COMMITTER_DATE="2026-06-20 16:47:03 +0200"
LOGLINE='print("booklogr-api boot: cache backend=" + str(app.config.get("CACHE_TYPE")))'
awk -v line="$LOGLINE" '
  { print }
  /^app\.config\.from_object\(Config\)$/ && !done { print line; done=1 }
' "$APP" > "$APP.tmp" && mv "$APP.tmp" "$APP"
grep -q 'booklogr-api boot: cache backend=' "$APP" || { echo "boot-log insert failed (app.py)"; exit 1; }
touch -r "$WORK/api/models.py" "$APP"
git -C "$WORK" add -- "$APP"
git -C "$WORK" commit -m "Log effective cache backend at boot" >/dev/null

# --- anchor BASELINE_REF at the result (restore/cleanup runs in the trap) ----
git -C "$WORK" branch -f "$BASELINE_REF" "$SCRATCH"
echo "prepared scenario '$SCENARIO_ID': local anchor '$BASELINE_REF' -> $(git -C "$WORK" rev-parse "$BASELINE_REF") (host-side only; never pushed to origin)"
