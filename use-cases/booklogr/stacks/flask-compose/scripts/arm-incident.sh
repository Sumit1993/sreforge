#!/usr/bin/env bash
# =============================================================================
# arm-incident.sh — reset to the regressed baseline, start the storm, confirm
# the alert fires. This is the MANUAL/combined entrypoint (`task arm`): it runs
# the two arm phases back-to-back so behaviour is unchanged.
#
# The two phases are split so the auto-incident path (#22) can interleave the
# per-run /workspace clone + box + listener between them:
#   1. arm-regress.sh — regress substrate/forge, bring the regressed app up
#      healthy, load quiesced (NOT firing). The /workspace clone must happen
#      AFTER this so its base-sha matches the armed head (modes 2/3).
#   2. arm-fire.sh    — re-apply load and confirm the alert fires. Under
#      automation this runs AFTER the in-box webhook listener is up so the
#      Alertmanager push is caught.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS

bash "$HERE/arm-regress.sh"
bash "$HERE/arm-fire.sh"
