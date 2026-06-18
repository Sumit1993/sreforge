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
  # Normalize mtime to match the rest of the checked-out tree. Editing in place
  # leaves config.py as the lone mtime outlier (its mtime == image build time),
  # which a `find -newermt` points straight at; a genuine git checkout gives every
  # file the same mtime. Match an untouched sibling so nothing stands out.
  touch -r "$WORK/api/models.py" "$CFG"
  echo "applied: CACHE_TYPE -> NullCache"
fi

export GIT_AUTHOR_NAME="Andreas Backström" GIT_AUTHOR_EMAIL="mozzo242@gmail.com"
export GIT_COMMITTER_NAME="Andreas Backström" GIT_COMMITTER_EMAIL="mozzo242@gmail.com"
# Author with the maintainer's real timezone (CEST, +0200) on a plausible date a
# few days after the last upstream commit — NOT the UTC forge-build moment, which
# stamps every staged commit at the same second in +0000 and breaks the author's
# established +0200 history.
export GIT_AUTHOR_DATE="2026-06-11 10:34:52 +0200" GIT_COMMITTER_DATE="2026-06-11 10:34:52 +0200"
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "nothing to commit (already on baseline)"
else
  git -C "$WORK" commit -m "Disable response caching" >/dev/null
  echo "committed regression"
fi
git -C "$WORK" push origin HEAD
# The baseline anchor stays HOST-SIDE only (a local branch). Publishing it to
# origin created a `baseline` branch byte-identical to main that itself carried
# the regression — a glaring reset-anchor tell (`git diff baseline main` empty,
# no such branch upstream). The conductor + arm-incident reset from this LOCAL
# ref instead, so the agent-visible origin never shows it.
git -C "$WORK" branch -f baseline HEAD
echo "baseline now carries the regression (local anchor only; not pushed to origin)"
