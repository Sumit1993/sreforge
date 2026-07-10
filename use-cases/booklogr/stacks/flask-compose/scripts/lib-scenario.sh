# source_scenario_env <scenario-id>
#   Sources use-cases/booklogr/stacks/flask-compose/scenarios/<scenario-id>/scenario.env
#   into the CURRENT shell's exported environment (set -a ... set +a), so both this
#   bash process and any node child process it later execs (run-incident.mjs cannot
#   source shell files itself) see the same scenario config. Fails loudly if the file
#   is missing — a scenario without a scenario.env is a build bug, not a runtime
#   fallback case.
source_scenario_env() {
  local id="$1"
  local f="$STACK/scenarios/$id/scenario.env"
  [ -f "$f" ] || { echo "ERROR: no scenario.env for scenario '$id' (expected $f)" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}
