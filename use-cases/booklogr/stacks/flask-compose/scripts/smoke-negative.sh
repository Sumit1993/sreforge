#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve paths; load env
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"

set -a; . "$STACK/.env"; set +a

# 2. Arm: put the stack into a confirmed-firing incident state
bash "$SCRIPTS/arm-incident.sh"

# 3. Run the wrong fix (the no-op fixture)
RUN_ID="smoke-neg-$(date +%s)"
echo "==> Running no-op fix (run-id: $RUN_ID)..."
if node "$SCRIPTS/run-incident.mjs" --run-id "$RUN_ID" --patch "$SCRIPTS/fixtures/no-op-fix.patch" --message "Increase search cache timeout"; then
  rc=0
else
  rc=$?
fi

# 4. Read verdict from run record
verdict=$(python3 -c "import json,sys; d=json.load(open('$STACK/runs/$RUN_ID/record.json')); print(d['verdict'])" 2>/dev/null || echo "missing")

# 5. Assert the anti-cheat held
if [ "$verdict" = "passed" ]; then
  echo "SMOKE NEGATIVE: ANTI-CHEAT BREACH (garbage fix passed!)"
  exit 1
elif [ "$verdict" = "failed" ] || [ "$verdict" = "rejected" ]; then
  echo "SMOKE NEGATIVE: PASS (anti-cheat held; verdict=$verdict)"
  exit 0
else
  echo "SMOKE NEGATIVE: INCONCLUSIVE (verdict=$verdict) — engine error, not a clean rejection"
  exit 2
fi
