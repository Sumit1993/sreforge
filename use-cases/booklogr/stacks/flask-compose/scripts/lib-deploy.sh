# Shared: resolve a NEUTRAL deploy directory (a symlink to this stack) and the
# compose-file paths under it. Running `docker compose` from the neutral path
# keeps the project labels an agent can read via `docker inspect`
# (com.docker.compose.project.config_files / working_dir) free of the harness
# path (.../sreforge/use-cases/booklogr/stacks/flask-compose) — a staged-rig tell.
# The symlink TARGET is invisible to the agent (it has no host-filesystem access);
# only the neutral path shows up in the labels. Build contexts and bind-mount
# sources are not affected (build paths aren't runtime labels, and on WSL2+Rancher
# bind sources surface as neutral docker-mounts shim UUIDs).
#
# Sets: DEPLOY_DIR, COMPOSE_FILE, LOAD_FILE. Expects STACK to be set. Idempotent.
# Override the neutral root with SREFORGE_DEPLOY_DIR; otherwise tries /srv/booklogr
# then ~/srv/booklogr, falling back to STACK (label leaks but deploy still works).
_resolve_deploy_dir() {
  local cand
  for cand in "${SREFORGE_DEPLOY_DIR:-}" /srv/booklogr "$HOME/srv/booklogr"; do
    [ -n "$cand" ] || continue
    mkdir -p "$(dirname "$cand")" 2>/dev/null || continue
    if ln -sfn "$STACK" "$cand" 2>/dev/null && [ "$(readlink "$cand" 2>/dev/null)" = "$STACK" ]; then
      printf '%s\n' "$cand"; return 0
    fi
  done
  printf '%s\n' "$STACK"
}
DEPLOY_DIR="$(_resolve_deploy_dir)"
COMPOSE_FILE="$DEPLOY_DIR/compose/docker-compose.yml"
LOAD_FILE="$DEPLOY_DIR/compose/load.yml"
