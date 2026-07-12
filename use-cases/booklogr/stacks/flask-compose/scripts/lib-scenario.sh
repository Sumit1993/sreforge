# source_scenario_env <scenario-id>
#   Sources use-cases/booklogr/stacks/flask-compose/scenarios/<scenario-id>/scenario.env
#   into the CURRENT shell's exported environment (set -a ... set +a), so both this
#   bash process and any node child process it later execs (run-incident.mjs cannot
#   source shell files itself) see the same scenario config. Fails loudly if the file
#   is missing — a scenario without a scenario.env is a build bug, not a runtime
#   fallback case.
#
# Expects STACK to already be exported by the caller (same contract as
# lib-deploy.sh) — bash callers derive it from BASH_SOURCE before sourcing
# this file; the Taskfile's `run` recipe exports it from go-task's
# TASKFILE_DIR, since go-task's sh interpreter provides no BASH_SOURCE for an
# inline-sourced script. Fail loudly rather than resolve a bogus path.
source_scenario_env() {
  local id="$1"
  : "${STACK:?source_scenario_env: STACK is not set — export it before sourcing lib-scenario.sh}"
  local f="$STACK/scenarios/$id/scenario.env"
  [ -f "$f" ] || { echo "ERROR: no scenario.env for scenario '$id' (expected $f)" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}
