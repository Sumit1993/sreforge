#!/usr/bin/env bash
# =============================================================================
# verify-detell.sh — HOST-SIDE live de-tell audit of the deploy plane.
#
# WHAT THIS IS (and how it differs from verify-boundary.sh)
#   verify-boundary.sh runs INSIDE the agent-shell and asserts the AGENT-POV
#   invariants (the agent has no docker, so it cannot enumerate containers).
#   verify-detell.sh runs on the HOST, with real docker, and inspects the
#   deploy-plane containers AS A FUTURE AGENT-WITH-DOCKER WOULD SEE THEM (once the
#   scoped-real docker view lands — see infra/agent-sandbox/README.md). It asserts
#   the deployment leaks NO harness/eval tells through docker metadata, and that
#   the image build clock is coherent with the git/file clocks.
#
#   It is an ORACLE/intake gate, never run by or for the agent — it runs ON the
#   agent's environment. It introduces zero agent-visible surface: it only reads
#   existing container metadata and prints to host stdout.
#
# WHAT IT CHECKS (the completeness-tax surface a real `docker` opens up)
#   1. ENV    — no GITEA_TOKEN / SCENARIO / BASELINE / INJECT_* vars; no harness
#               host names bleeding into any deploy container's environment.
#   2. LABEL  — com.docker.compose.project is the neutral app project; no labels
#               named after the harness.
#   3. MOUNT  — the real harness repo tree is not bind-mounted into any deploy
#               container. (The /srv/booklogr NEUTRAL symlink is expected, NOT a
#               tell — it is the cover path; only the real sreforge tree is a leak.)
#   4. LOGS   — startup/entrypoint logs carry no harness/eval vocabulary.
#   5. CLOCK  — image build time vs the substrate's git HEAD time: a fresh
#               incident-time build against days-old history is a tell (the known,
#               still-open image-build-clock residual — this surfaces it).
#
#   Exits NON-ZERO on any hard FAIL. WARNs are surfaced but do not fail the run
#   (e.g. the image-clock residual is a WARN until that residual is closed).
#
# USAGE (host, from the stack dir or anywhere):
#   bash scripts/verify-detell.sh
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"

COMPOSE_PROJECT="${COMPOSE_PROJECT:-booklogr}"
# The deploy-plane services an agent-with-docker could enumerate.
DEPLOY_SERVICES="booklogr-api booklogr-web booklogr-db prometheus alertmanager grafana book-metadata"

# ---- Tell patterns ---------------------------------------------------------
# Hard tells (must NEVER appear in agent-visible docker metadata):
HARNESS_VAR_NAMES='GITEA_TOKEN|GITEA_RUNNER|SCENARIO|BASELINE|INJECT_|ANSWER_KEY|SOLUTION'
HARNESS_HOSTS='sreforge-gitea|sreforge-runner|sreforge-forge|edge-client'
# The REAL harness tree is a hard leak; /srv/booklogr (neutral symlink cover) is NOT.
HARNESS_REPO_PATH='/home/sumit/sources/sreforge-workspace/sreforge'
WORKSPACE_MARKER='\.run-workspace|substrate/booklogr'
HARNESS_LABEL_PREFIX='sreforge|eval\.|baseline|inject'
# Soft tells (surface for review, do not hard-fail). Harness-SPECIFIC terms only:
# a bare 'inject' would false-positive on nginx's standard 'inject-env.sh' entry
# (legit frontend env injection), and 'scenario'/'eval' are too generic for app
# logs — so we anchor to the harness's own vocabulary instead.
SOFT_VOCAB='sreforge|inject-regression|fault-inject|answer.?key|/solution/|[^a-z]baseline[^d]'

FAILS=0; WARNS=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  WARN  %s\n' "$1"; WARNS=$((WARNS + 1)); }
hdr()  { printf '\n== %s ==\n' "$1"; }

cid_of() { docker compose -p "$COMPOSE_PROJECT" ps -q "$1" 2>/dev/null || true; }

hdr "LIVE DE-TELL AUDIT — deploy plane '$COMPOSE_PROJECT' (host-side, real docker)"

# ---- 1. ENV AUDIT ----------------------------------------------------------
hdr "1. ENV (no harness vars / hosts in deploy container environment)"
for svc in $DEPLOY_SERVICES; do
  cid="$(cid_of "$svc")"; [ -z "$cid" ] && { warn "$svc: not running (skip)"; continue; }
  env="$(docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
  if printf '%s' "$env" | grep -Eq "^($HARNESS_VAR_NAMES)="; then
    fail "$svc: harness env var: $(printf '%s' "$env" | grep -E "^($HARNESS_VAR_NAMES)=" | head -1 | cut -d= -f1)"
  elif printf '%s' "$env" | grep -Eqi "$HARNESS_HOSTS"; then
    fail "$svc: harness host in env: $(printf '%s' "$env" | grep -Ei "$HARNESS_HOSTS" | head -1)"
  else
    pass "$svc: env clean"
  fi
done

# ---- 2. LABEL AUDIT --------------------------------------------------------
hdr "2. LABEL (neutral compose project; no harness-named labels)"
for svc in $DEPLOY_SERVICES; do
  cid="$(cid_of "$svc")"; [ -z "$cid" ] && { warn "$svc: not running (skip)"; continue; }
  labels="$(docker inspect "$cid" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}' 2>/dev/null || true)"
  proj="$(printf '%s' "$labels" | grep '^com\.docker\.compose\.project=' | head -1 | cut -d= -f2 || true)"
  if [ -n "$proj" ] && [ "$proj" != "$COMPOSE_PROJECT" ]; then
    warn "$svc: compose project label = '$proj' (expected '$COMPOSE_PROJECT')"
  fi
  if printf '%s' "$labels" | grep -Eqi "^($HARNESS_LABEL_PREFIX)"; then
    fail "$svc: harness-named label: $(printf '%s' "$labels" | grep -Ei "^($HARNESS_LABEL_PREFIX)" | head -1)"
  else
    pass "$svc: labels clean (project=${proj:-none})"
  fi
done

# ---- 3. MOUNT AUDIT --------------------------------------------------------
hdr "3. MOUNT (real harness tree not bind-mounted; /srv cover is OK)"
for svc in $DEPLOY_SERVICES; do
  cid="$(cid_of "$svc")"; [ -z "$cid" ] && { warn "$svc: not running (skip)"; continue; }
  srcs="$(docker inspect "$cid" --format '{{range .Mounts}}{{println .Source}}{{end}}' 2>/dev/null || true)"
  if printf '%s' "$srcs" | grep -Eq "$HARNESS_REPO_PATH|$WORKSPACE_MARKER"; then
    fail "$svc: harness path mounted: $(printf '%s' "$srcs" | grep -E "$HARNESS_REPO_PATH|$WORKSPACE_MARKER" | head -1)"
  else
    pass "$svc: mounts neutral"
  fi
done

# ---- 4. LOGS AUDIT ---------------------------------------------------------
hdr "4. LOGS (startup logs free of harness/eval vocabulary)"
for svc in $DEPLOY_SERVICES; do
  cid="$(cid_of "$svc")"; [ -z "$cid" ] && { warn "$svc: not running (skip)"; continue; }
  logs="$(docker logs "$cid" 2>&1 | head -60 || true)"
  hit="$(printf '%s' "$logs" | grep -Ei "$SOFT_VOCAB" | head -1 || true)"
  if [ -n "$hit" ]; then
    warn "$svc: log line mentions a tell (review): $hit"
  else
    pass "$svc: logs clean"
  fi
done

# ---- 5. IMAGE CLOCK AUDIT --------------------------------------------------
hdr "5. CLOCK (image build time vs substrate git HEAD; gap = staged-build tell)"
clock_one() {
  svc="$1"; src="$2"
  cid="$(cid_of "$svc")"; [ -z "$cid" ] && { warn "$svc: not running (skip)"; return; }
  img="$(docker inspect "$cid" --format '{{.Image}}' 2>/dev/null || true)"
  created="$(docker image inspect "$img" --format '{{.Created}}' 2>/dev/null || true)"
  ie="$(date -d "$created" +%s 2>/dev/null || echo 0)"
  [ "$ie" -eq 0 ] && { warn "$svc: image timestamp unparseable"; return; }
  if [ -d "$STACK/$src/.git" ]; then
    ge="$(git -C "$STACK/$src" log -1 --format=%ct 2>/dev/null || echo 0)"
    if [ "$ge" -gt 0 ]; then
      gap=$(( ie - ge ))
      if [ "$gap" -gt 3600 ]; then
        warn "$svc: image built $(( gap / 3600 ))h after git HEAD — incident-fresh build (known image-clock residual)"
      else
        pass "$svc: image/git clock coherent"
      fi
    else
      warn "$svc: git HEAD time unreadable (skip)"
    fi
  else
    warn "$svc: substrate git not local at $src (skip)"
  fi
}
clock_one booklogr-api  substrate/booklogr
clock_one booklogr-web  substrate/booklogr
clock_one book-metadata stub

# ---- Verdict ---------------------------------------------------------------
hdr "VERDICT"
if [ "$FAILS" -eq 0 ]; then
  printf '  DE-TELL OK — 0 hard leaks%s. The deploy plane carries no harness tells.\n' \
    "$([ "$WARNS" -eq 0 ] && echo '' || echo " ($WARNS warn(s) — review/residuals)")"
  exit 0
else
  printf '  DE-TELL BREACHED — %d hard leak(s)%s. See FAIL lines.\n' \
    "$FAILS" "$([ "$WARNS" -eq 0 ] && echo '' || echo ", $WARNS warn(s)")"
  exit 1
fi
