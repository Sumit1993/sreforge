#!/usr/bin/env bash
# orchestrate.sh — Admin entry point for the Todo App simulation.
#
# Commands:
#   inject   --scenario <id> [--env k8s|docker|vm]
#   reset    [--env k8s|docker|vm] [--repo <repo-name>]
#   status
#   validate --scenario <id>
#
# Requires workspace/ to be populated via scripts/clone-workspace.sh
#
# ADMIN ONLY — never commit workspace/ or run this from agent-visible repos.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
ISSUES_DIR="$REPO_ROOT/infra/issues"
INJECTOR="$ISSUES_DIR/injector.sh"

# ── helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $0 <command> [options]

Commands:
  inject   --scenario <id> [--env k8s|docker|vm]
  reset    [--env k8s|docker|vm] [--repo <name>]
  status
  validate --scenario <id>

Examples:
  $0 inject --scenario oom-kill-nestjs --env k8s
  $0 reset --env k8s
  $0 status
  $0 validate --scenario oom-kill-nestjs
EOF
  exit 1
}

require_workspace() {
  if [[ ! -d "$WORKSPACE" ]]; then
    echo "ERROR: workspace/ not found. Run scripts/clone-workspace.sh first." >&2
    exit 1
  fi
}

find_scenario() {
  local id="$1"
  local file="$ISSUES_DIR/${id}.yaml"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: Scenario not found: $id" >&2
    echo "Available scenarios:" >&2
    ls "$ISSUES_DIR"/*.yaml 2>/dev/null | xargs -I{} basename {} .yaml | sed 's/^/  /' >&2
    exit 1
  fi
  echo "$file"
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_inject() {
  local scenario="" env="k8s"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scenario) scenario="$2"; shift 2 ;;
      --env)      env="$2";      shift 2 ;;
      *) echo "Unknown option: $1" >&2; usage ;;
    esac
  done

  [[ -z "$scenario" ]] && { echo "ERROR: --scenario required" >&2; usage; }

  require_workspace
  local scenario_file
  scenario_file="$(find_scenario "$scenario")"

  echo "[inject] scenario=$scenario env=$env"
  bash "$INJECTOR" inject "$scenario_file" "$WORKSPACE"
}

cmd_reset() {
  local env="k8s" repo=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env)  env="$2";  shift 2 ;;
      --repo) repo="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; usage ;;
    esac
  done

  require_workspace

  if [[ -n "$repo" ]]; then
    local target="$WORKSPACE/$repo"
    if [[ ! -d "$target/.git" ]]; then
      echo "ERROR: $repo not found in workspace/" >&2; exit 1
    fi
    echo "[reset] reverting $repo to origin/main"
    git -C "$target" fetch origin
    git -C "$target" checkout main
    git -C "$target" reset --hard origin/main
  else
    echo "[reset] reverting all workspace repos for env=$env"
    for repo_dir in "$WORKSPACE"/*/; do
      name="$(basename "$repo_dir")"
      if [[ -d "$repo_dir/.git" ]]; then
        echo "  resetting $name"
        git -C "$repo_dir" fetch origin
        git -C "$repo_dir" checkout main
        git -C "$repo_dir" reset --hard origin/main
      fi
    done
  fi

  echo "[reset] done"
}

cmd_status() {
  require_workspace

  echo "Workspace: $WORKSPACE"
  echo ""
  printf "%-30s %-12s %-10s %s\n" "REPO" "BRANCH" "COMMIT" "STATUS"
  printf "%-30s %-12s %-10s %s\n" "----" "------" "------" "------"

  for repo_dir in "$WORKSPACE"/*/; do
    name="$(basename "$repo_dir")"
    if [[ -d "$repo_dir/.git" ]]; then
      branch=$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
      commit=$(git -C "$repo_dir" rev-parse --short HEAD 2>/dev/null || echo "?")
      dirty=$(git -C "$repo_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      status_str="clean"
      [[ "$dirty" -gt 0 ]] && status_str="DIRTY ($dirty files)"
      printf "%-30s %-12s %-10s %s\n" "$name" "$branch" "$commit" "$status_str"
    else
      printf "%-30s %-12s %-10s %s\n" "$name" "-" "-" "MISSING"
    fi
  done

  echo ""
  echo "Issues dir: $ISSUES_DIR"
  local count
  count=$(ls "$ISSUES_DIR"/*.yaml 2>/dev/null | wc -l | tr -d ' ')
  echo "Scenarios available: $count"
}

cmd_validate() {
  local scenario=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scenario) scenario="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; usage ;;
    esac
  done

  [[ -z "$scenario" ]] && { echo "ERROR: --scenario required" >&2; usage; }

  local scenario_file
  scenario_file="$(find_scenario "$scenario")"

  echo "[validate] scenario=$scenario"
  bash "$INJECTOR" validate "$scenario_file"
}

# ── dispatch ─────────────────────────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

COMMAND="$1"; shift

case "$COMMAND" in
  inject)   cmd_inject   "$@" ;;
  reset)    cmd_reset    "$@" ;;
  status)   cmd_status        ;;
  validate) cmd_validate "$@" ;;
  *)        echo "Unknown command: $COMMAND" >&2; usage ;;
esac
