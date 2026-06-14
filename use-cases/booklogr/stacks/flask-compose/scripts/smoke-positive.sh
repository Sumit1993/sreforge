#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve paths
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"

# 2. Load env
set -a; . "$STACK/.env"; set +a

# 3. Arm: put the stack into a confirmed-firing incident state
bash "$SCRIPTS/arm-incident.sh"

# 4. Run the reference (correct) fix
RUN_ID="smoke-pos-$(date +%s)"
echo "==> Running reference fix (run-id: $RUN_ID)..."
if node "$SCRIPTS/run-incident.mjs" --run-id "$RUN_ID"; then
  rc=0
else
  rc=$?
fi

# 5. Read verdict from run record
verdict=$(python3 -c "import json,sys; d=json.load(open('$STACK/runs/$RUN_ID/record.json')); print(d['verdict'])")

# 6. Assert: verdict == "passed" AND rc == 0
if [ "$verdict" = "passed" ] && [ "$rc" -eq 0 ]; then
  echo "SMOKE POSITIVE: PASS (verdict=passed)"
  exit 0
else
  echo "SMOKE POSITIVE: FAIL (verdict=$verdict rc=$rc)"
  exit 1
fi
