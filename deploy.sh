#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_DIR="${SCRIPT_DIR}/infra/profiles"
HELM_UMBRELLA="${SCRIPT_DIR}/infra/helm/umbrella"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy]${NC} $*" >&2; }

# --- Dependency checks ---
check_yq() {
  command -v yq >/dev/null 2>&1 || {
    error "yq is required but not installed."
    error "Install: choco install yq  OR  winget install MikeFarah.yq"
    error "See: https://github.com/mikefarah/yq#install"
    exit 1
  }
}

check_helm() {
  command -v helm >/dev/null 2>&1 || {
    error "helm is required for Kubernetes topology."
    error "Install: choco install kubernetes-helm"
    exit 1
  }
}

# --- Profile loading ---
load_profile() {
  local profile_name="$1"
  PROFILE_FILE="${PROFILES_DIR}/${profile_name}.yaml"
  if [[ ! -f "$PROFILE_FILE" ]]; then
    error "Profile '${profile_name}' not found at ${PROFILE_FILE}"
    error "Available profiles:"
    ls -1 "${PROFILES_DIR}"/*.yaml 2>/dev/null | xargs -I{} basename {} .yaml | sed 's/^/  /'
    exit 1
  fi
  TOPOLOGY=$(yq '.topology' "$PROFILE_FILE")
  NAMESPACE=$(yq '.namespace // "todo-app"' "$PROFILE_FILE")
  log "Loaded profile: ${profile_name} (topology=${TOPOLOGY}, namespace=${NAMESPACE})"
}

# --- Template variable resolution ---
resolve_git_sha() {
  GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
}

# --- Deploy ---
deploy() {
  local profile_name="$1"
  local target="${2:-local}"

  check_yq
  load_profile "$profile_name"
  resolve_git_sha

  case "$TOPOLOGY" in
    kubernetes)
      check_helm
      log "Building Helm dependencies..."
      helm dependency update "$HELM_UMBRELLA" --skip-refresh 2>/dev/null || helm dependency update "$HELM_UMBRELLA"

      log "Deploying to Kubernetes (target=${target})..."
      local set_args=()
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local key val
        key=$(echo "$line" | cut -d'=' -f1)
        val=$(echo "$line" | cut -d'=' -f2-)
        val="${val//\{\{git-sha\}\}/$GIT_SHA}"
        set_args+=(--set "$key=$val")
      done < <(yq '.deploy.values | to_entries | .[] | .key + "=" + (.value | tostring)' "$PROFILE_FILE" 2>/dev/null)

      helm upgrade --install todo-app "$HELM_UMBRELLA" \
        --namespace "$NAMESPACE" \
        --create-namespace \
        "${set_args[@]}" \
        --rollback-on-failure

      log "Deployed successfully. Run: kubectl get pods -n ${NAMESPACE}"
      ;;
    docker)
      error "Docker topology not implemented (Phase 3)"
      exit 1
      ;;
    vm)
      error "VM/Kamal topology not implemented (Phase 3)"
      exit 1
      ;;
    serverless)
      error "Serverless topology not implemented (Phase 5)"
      exit 1
      ;;
    *)
      error "Unknown topology: ${TOPOLOGY}"
      exit 1
      ;;
  esac
}

# --- Switch backend ---
switch_backend() {
  local backend="$1"
  check_helm
  log "Switching default backend to: ${backend}"
  helm upgrade todo-app "$HELM_UMBRELLA" \
    --namespace todo-app \
    --reuse-values \
    --set "gateway.defaultBackend=${backend}"
  log "Backend switched to ${backend}"
}

# --- Teardown ---
teardown() {
  local profile_name="$1"
  check_yq
  load_profile "$profile_name"

  case "$TOPOLOGY" in
    kubernetes)
      check_helm
      log "Tearing down Kubernetes deployment..."
      helm uninstall todo-app --namespace "$NAMESPACE" 2>/dev/null || warn "No release found"
      log "Teardown complete"
      ;;
    docker)
      error "Docker teardown not implemented (Phase 3)"
      ;;
    vm)
      error "VM teardown not implemented (Phase 3)"
      ;;
    *)
      error "Unknown topology: ${TOPOLOGY}"
      exit 1
      ;;
  esac
}

# --- Status ---
status() {
  echo "=== Helm Releases ==="
  helm list --all-namespaces 2>/dev/null || warn "helm not available"
  echo ""
  echo "=== K8s Pods ==="
  kubectl get pods --all-namespaces -l "app.kubernetes.io/managed-by=Helm" 2>/dev/null || warn "kubectl not available"
  echo ""
  echo "=== Gateway Routes ==="
  kubectl get httproutes --all-namespaces 2>/dev/null || warn "Gateway API CRDs not installed"
}

# --- Usage ---
usage() {
  cat <<EOF
Usage:
  $0 --profile <name> [--target <target>]   Deploy a profile
  $0 switch --backend <language>            Switch default API backend
  $0 teardown --profile <name>              Tear down a deployment
  $0 status                                 Show deployment status

Examples:
  $0 --profile nestjs-k8s-full --target local
  $0 switch --backend python
  $0 teardown --profile nestjs-k8s-full
  $0 status
EOF
}

# --- Main ---
case "${1:-}" in
  --profile)
    PROFILE="${2:?Missing profile name}"
    TARGET="local"
    shift 2
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --target) TARGET="${2:?Missing target}"; shift 2 ;;
        *) error "Unknown flag: $1"; usage; exit 1 ;;
      esac
    done
    deploy "$PROFILE" "$TARGET"
    ;;
  switch)
    shift
    case "${1:-}" in
      --backend) switch_backend "${2:?Missing backend language}" ;;
      *) error "Usage: $0 switch --backend <language>"; exit 1 ;;
    esac
    ;;
  teardown)
    shift
    case "${1:-}" in
      --profile) teardown "${2:?Missing profile name}" ;;
      *) error "Usage: $0 teardown --profile <name>"; exit 1 ;;
    esac
    ;;
  status)
    status
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    error "Unknown command: $1"
    usage
    exit 1
    ;;
esac
