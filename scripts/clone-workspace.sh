#!/usr/bin/env bash
# clone-workspace.sh — Clone all service+ops repos into workspace/
# Run once to set up the local orchestration workspace.
#
# Usage:
#   ./scripts/clone-workspace.sh [--org <github-org>]
#
# Default org: todo-corp
# Repos are cloned into workspace/<repo-name>/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="$REPO_ROOT/workspace"

ORG="${ORG:-todo-corp}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

REPOS=(
  "todo-app-api-nestjs"
  "todo-app-ui"
  "todo-app-ops-k8s"
  "todo-app-ops-docker"
  "todo-app-ops-vm"
)

echo "Cloning repos for org: $ORG"
echo "Workspace: $WORKSPACE"
echo ""

mkdir -p "$WORKSPACE"

for repo in "${REPOS[@]}"; do
  dest="$WORKSPACE/$repo"
  url="git@github.com:${ORG}/${repo}.git"

  if [[ -d "$dest/.git" ]]; then
    echo "  [pull]  $repo"
    git -C "$dest" pull --ff-only
  else
    echo "  [clone] $repo"
    git clone "$url" "$dest"
  fi
done

echo ""
echo "Workspace ready at: $WORKSPACE"
echo ""
echo "Repos:"
for repo in "${REPOS[@]}"; do
  dest="$WORKSPACE/$repo"
  if [[ -d "$dest/.git" ]]; then
    branch=$(git -C "$dest" rev-parse --abbrev-ref HEAD)
    commit=$(git -C "$dest" rev-parse --short HEAD)
    echo "  $repo  [$branch @ $commit]"
  else
    echo "  $repo  [MISSING]"
  fi
done
