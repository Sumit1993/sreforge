#!/usr/bin/env bash
# Author the latency-cache-stampede regression onto the imported baseline:
# disable the search-response cache (CACHE_TYPE SimpleCache -> NullCache). This
# is an existing-code edit on the caching layer that fronts the slow book
# provider — never a bolt-on. Committed under the project's authorship so the
# baseline history stays consistent with the imported upstream.
#
# Idempotent. Run after import-substrate.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
WORK="$STACK/substrate/booklogr"
CFG="$WORK/api/config.py"

[ -f "$CFG" ] || { echo "substrate not found at $WORK — run import-substrate.sh first"; exit 1; }

if grep -q 'CACHE_TYPE = "NullCache"' "$CFG"; then
  echo "regression already applied"
else
  sed -i 's/    CACHE_TYPE = "SimpleCache"/    CACHE_TYPE = "NullCache"/' "$CFG"
  grep -q 'CACHE_TYPE = "NullCache"' "$CFG" || { echo "sed anchor not found"; exit 1; }
  echo "applied: CACHE_TYPE -> NullCache"
fi

export GIT_AUTHOR_NAME="Andreas Backström" GIT_AUTHOR_EMAIL="mozzo242@gmail.com"
export GIT_COMMITTER_NAME="Andreas Backström" GIT_COMMITTER_EMAIL="mozzo242@gmail.com"
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "nothing to commit (already on baseline)"
else
  git -C "$WORK" commit -m "Disable response cache for search while debugging stale results" >/dev/null
  echo "committed regression"
fi
git -C "$WORK" push origin HEAD
git -C "$WORK" branch -f baseline HEAD
git -C "$WORK" push -f origin baseline
echo "baseline now carries the regression"
