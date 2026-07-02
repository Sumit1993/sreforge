#!/usr/bin/env bash
# =============================================================================
# verify-boundary.sh — assert the ADR-0009 agent-sandbox boundary FROM INSIDE the box.
#
# WHAT THIS IS
#   The external SRE agent is exec'd into the `agent-shell` container (compose
#   project `sreforge-agent`, infra/agent-sandbox/agent.yml). This script runs
#   INSIDE that container and proves the boundary holds:
#     1. REACHABLE     — every documented endpoint answers (app + Prometheus +
#                        Grafana + Alertmanager). [Loki is intentionally N/A —
#                        this stack has none; see note below.]
#     2. HARNESS HIDDEN — no docker access AND the harness (Gitea forge, Actions
#                        runner, k6 edge/load driver) does not resolve and is not
#                        reachable on the forge port.
#     3. FS CLEAN      — the host harness repo is absent; only /workspace is the
#                        mounted source tree.
#     4. GIT CLEAN     — /workspace has no `baseline` branch and `origin` carries
#                        no forge tell (e.g. "sreforge-gitea" / the forge host).
#
#   It exits NON-ZERO on ANY leak. Each check prints PASS / FAIL (or WARN).
#
# HOW TO RUN
#   From the host, exec it into the already-running sandbox:
#
#     docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
#       exec -u "$(id -u):$(id -g)" agent-shell sh /workspace/<path>/verify-boundary.sh
#
#   ...if this script has been copied into the per-run /workspace. Otherwise copy
#   it in first and run it by its in-container path:
#
#     docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-boundary.sh \
#       agent-shell:/tmp/verify-boundary.sh
#     docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
#       exec -u "$(id -u):$(id -g)" agent-shell sh /tmp/verify-boundary.sh
#
#   Or, once inside the shell (`... exec -u "$(id -u):$(id -g)" agent-shell sh`):
#
#     sh /tmp/verify-boundary.sh
#
# DEPENDENCY-LIGHT
#   Uses only curl, getent (with an nslookup fallback), git, grep — the tools the
#   agent-shell already has (curl + git are installed at bring-up; getent/nslookup
#   ship with alpine's musl/busybox). All curl probes are timeout-bounded.
#
# NOTE — the shell is alpine + busybox; we deliberately invoke this with `sh`,
# but `set -euo pipefail` is honored by busybox ash as well as bash.
# =============================================================================
set -euo pipefail

# ---- Config: endpoints + harness names -------------------------------------
# Prefer the env the sandbox injects (agent.yml), fall back to the documented
# service-DNS defaults so the script also works if run before env is sourced.
API_URL="${API_URL:-http://booklogr-api:5000}"
PROM_URL="${PROM_URL:-http://prometheus:9090}"
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://alertmanager:9093}"
GRAFANA_URL="${GRAFANA_URL:-http://grafana:3000}"
# LOKI_URL is intentionally NOT set: this stack has no Loki. See REACHABLE below.

# Harness hosts that must be invisible (contract harnessHidden). The forge
# (Gitea) listens on container port 3000; the agent must not resolve or reach it.
HARNESS_HOSTS="sreforge-gitea sreforge-runner edge-client"
FORGE_PORT="3000"

# The host harness repo path — must NOT be visible inside the box.
HARNESS_REPO="/home/sumit/sources/sreforge-workspace/sreforge"
WORKSPACE="/workspace"

# curl timeouts (seconds): connect + total. Kept short so an unreachable host
# fails fast rather than hanging the whole run.
CONNECT_TIMEOUT=3
MAX_TIME=8

# ---- Result tracking -------------------------------------------------------
FAILS=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  WARN  %s\n' "$1"; }
hdr()  { printf '\n== %s ==\n' "$1"; }

# curl wrapper: silent, timeout-bounded, no proxy surprises. Returns the body on
# stdout; caller checks exit status.
cget() {
  curl -fsS --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$@"
}
# HTTP status only (does not require 2xx); empty on connect failure.
ccode() {
  curl -s -o /dev/null -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$1" 2>/dev/null || true
}

# ===========================================================================
# 1. REACHABLE — every documented endpoint must answer.
# ===========================================================================
hdr "1. REACHABLE (documented endpoints must succeed)"

# App health: the booklogr API has no dedicated /health route — its OWN compose
# healthcheck probes GET / (expects 200). We mirror that. BUT this script runs
# DURING an armed incident, when the app is deliberately sick (saturated/slow, or
# erroring on a failing upstream). "Did not return 2xx" is therefore NOT a boundary
# breach — only "the endpoint is not network-reachable" is. So we separate the two:
# a non-2xx HTTP answer (incl. 4xx/5xx) = reachable-but-incident-impacted (WARN);
# a no-HTTP-response (000) is disambiguated by a raw TCP connect probe — TCP open
# but HTTP-silent = saturated (WARN), TCP closed = genuine unreachability (FAIL).
code="$(ccode "$API_URL/")"
case "$code" in
  2??|3??)
    pass "app health: GET $API_URL/ -> HTTP $code (reachable, serving)" ;;
  000)
    hostport="${API_URL#*://}"; hostport="${hostport%%/*}"
    ahost="${hostport%%:*}"; aport="${hostport#*:}"; [ "$aport" = "$ahost" ] && aport=80
    if command -v nc >/dev/null 2>&1 && nc -z -w "$CONNECT_TIMEOUT" "$ahost" "$aport" >/dev/null 2>&1; then
      warn "app health: $API_URL/ HTTP-silent but TCP $ahost:$aport open — app saturated/slow (the incident), still reachable"
    elif command -v nc >/dev/null 2>&1; then
      fail "app health: $API_URL/ no HTTP response AND TCP $ahost:$aport closed — endpoint unreachable (breach)"
    else
      warn "app health: $API_URL/ no HTTP response; nc absent so TCP reach unprovable — likely saturation (the incident)"
    fi ;;
  *)
    warn "app health: GET $API_URL/ -> HTTP $code (reachable, app incident-impacted)" ;;
esac

# Prometheus readiness.
if cget "$PROM_URL/-/ready" >/dev/null 2>&1; then
  pass "Prometheus ready: $PROM_URL/-/ready"
else
  fail "Prometheus ready: $PROM_URL/-/ready unreachable/not-ready"
fi

# Grafana health (JSON; database should read 'ok').
gh="$(cget "$GRAFANA_URL/api/health" 2>/dev/null || true)"
if printf '%s' "$gh" | grep -q '"database"[[:space:]]*:[[:space:]]*"ok"'; then
  pass "Grafana health: $GRAFANA_URL/api/health (database=ok)"
elif [ -n "$gh" ]; then
  # Answered but database not ok — still reachable; treat shape mismatch as a
  # soft signal only if it clearly responded with a health doc.
  if printf '%s' "$gh" | grep -q '"version"\|"database"'; then
    warn "Grafana health: $GRAFANA_URL/api/health answered but database!=ok ($gh)"
  else
    fail "Grafana health: $GRAFANA_URL/api/health unexpected body ($gh)"
  fi
else
  fail "Grafana health: $GRAFANA_URL/api/health unreachable"
fi

# Alertmanager healthy.
if cget "$ALERTMANAGER_URL/-/healthy" >/dev/null 2>&1; then
  pass "Alertmanager healthy: $ALERTMANAGER_URL/-/healthy"
else
  fail "Alertmanager healthy: $ALERTMANAGER_URL/-/healthy unreachable/not-healthy"
fi

# Loki: the prompt's assertion list names Loki /ready, but this deployment has
# NO Loki service and the boundary contract advertises NO LOKI_URL. Probing a
# non-existent log store would either always fail (false leak) or, worse, imply
# to a reader that a log store should exist (a de-tell). So we explicitly mark it
# N/A rather than testing it. If a Loki service is later added to the deploy
# plane (and LOKI_URL to agent.yml), add a `$LOKI_URL/ready` probe here.
if [ -n "${LOKI_URL:-}" ]; then
  if cget "$LOKI_URL/ready" >/dev/null 2>&1; then
    pass "Loki ready: $LOKI_URL/ready"
  else
    fail "Loki ready: $LOKI_URL/ready unreachable/not-ready (LOKI_URL is set)"
  fi
else
  printf '  N/A   Loki: no Loki in this stack; LOKI_URL unset (by design, not a leak)\n'
fi

# ===========================================================================
# 2. HARNESS HIDDEN — no docker, and the harness does not resolve or connect.
# ===========================================================================
hdr "2. HARNESS HIDDEN (docker absent; forge/runner/load unreachable)"

# 2a. No docker access: either the CLI is absent, or if somehow present it cannot
# talk to a daemon (`docker ps` errors). Either condition is a PASS.
if ! command -v docker >/dev/null 2>&1; then
  pass "docker: CLI absent (command -v docker fails)"
else
  if docker ps >/dev/null 2>&1; then
    fail "docker: CLI present AND 'docker ps' succeeded — daemon is reachable (LEAK)"
  else
    pass "docker: CLI present but 'docker ps' errors (no reachable daemon)"
  fi
fi

# DNS resolver: getent if available, else nslookup. Returns 0 if the name
# resolves (i.e. a LEAK for harness names).
resolves() {
  name="$1"
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$name" >/dev/null 2>&1
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup "$name" >/dev/null 2>&1
  else
    # No resolver tool (getent and nslookup both absent — unusual on alpine):
    # fall back to curl's own resolver. curl exits 6 specifically when it cannot
    # resolve the host; we capture that exact code so "resolved" means "did NOT
    # get exit 6".
    rc=0
    curl -s --connect-timeout 2 --max-time 3 "http://$name:$FORGE_PORT/" >/dev/null 2>&1 || rc=$?
    [ "$rc" -ne 6 ]
  fi
}

# 2b. For each hidden harness host: it must NOT resolve, AND a TCP/curl probe to
# the forge port must FAIL. Both must hold for a PASS.
for h in $HARNESS_HOSTS; do
  dns_leak=0
  tcp_leak=0

  if resolves "$h"; then
    dns_leak=1
  fi

  # Connect probe to the forge HTTP port. Any non-empty HTTP status = it answered
  # = reachable = leak. A short timeout keeps an unroutable host fast-failing.
  pcode="$(ccode "http://$h:$FORGE_PORT/")"
  if [ -n "$pcode" ] && [ "$pcode" != "000" ]; then
    tcp_leak=1
  fi

  if [ "$dns_leak" -eq 0 ] && [ "$tcp_leak" -eq 0 ]; then
    pass "harness '$h': does not resolve AND $FORGE_PORT unreachable"
  else
    detail=""
    [ "$dns_leak" -eq 1 ] && detail="${detail} resolves(DNS-leak)"
    [ "$tcp_leak" -eq 1 ] && detail="${detail} ${h}:${FORGE_PORT}->HTTP${pcode}(reach-leak)"
    fail "harness '$h' is visible:${detail}"
  fi
done

# ===========================================================================
# 3. FS CLEAN — the host harness repo is absent; only /workspace is mounted.
# ===========================================================================
hdr "3. FS CLEAN (no harness repo on disk; /workspace is the source)"

if [ ! -e "$HARNESS_REPO" ]; then
  pass "harness repo absent: $HARNESS_REPO does not exist in-box"
else
  fail "harness repo PRESENT: $HARNESS_REPO is visible (LEAK)"
fi

if [ -d "$WORKSPACE" ]; then
  pass "workspace present: $WORKSPACE exists (the mounted source)"
else
  fail "workspace missing: $WORKSPACE does not exist"
fi

# ===========================================================================
# 4. GIT CLEAN — no baseline branch; origin carries no forge tell.
# ===========================================================================
hdr "4. GIT CLEAN (no baseline branch; origin not a forge tell)"

if ! command -v git >/dev/null 2>&1; then
  fail "git: CLI absent — cannot verify workspace git hygiene"
elif [ ! -d "$WORKSPACE/.git" ]; then
  warn "git: $WORKSPACE is not a git repo (.git absent) — skipping branch/remote checks"
elif ! git -C "$WORKSPACE" rev-parse --show-toplevel >/dev/null 2>&1; then
  # .git exists but git refuses to read the repo (e.g. "dubious ownership" when the
  # container uid != the bind-mount owner, or corruption). Without this guard the
  # branch/remote checks below FALSE-PASS: their `git ... | grep` finds nothing on
  # a git error and reads as "clean". Assert the repo is actually readable first.
  fail "git: $WORKSPACE/.git exists but the repo is not readable (dubious-ownership/corruption) — branch/remote hygiene UNVERIFIED"
else
  # 4a. No 'baseline' branch anywhere (local or remote-tracking). The baseline
  # anchor must never reach the workspace the agent clones.
  branches="$(git -C "$WORKSPACE" branch -a 2>/dev/null || true)"
  # Match a branch literally named 'baseline' (local, or */baseline remote ref),
  # not substrings like 'baselined'.
  if printf '%s\n' "$branches" | grep -Eq '(^|[ */])baseline([ ]|$)'; then
    fail "git: a 'baseline' branch is present in $WORKSPACE (LEAK):"
    printf '%s\n' "$branches" | grep -E '(^|[ */])baseline([ ]|$)' | sed 's/^/        /'
  else
    pass "git: no 'baseline' branch in $WORKSPACE"
  fi

  # 4b. origin must not betray the forge. A hard FAIL if it names the forge host
  # container ("sreforge-gitea") or the in-network alias on the forge port; a
  # loud WARN for softer forge hints (a literal "gitea" token, the forge service
  # alias). Best case: no origin at all (remotes stripped) or a neutral origin.
  remotes="$(git -C "$WORKSPACE" remote -v 2>/dev/null || true)"
  origin="$(git -C "$WORKSPACE" remote get-url origin 2>/dev/null || true)"

  if [ -z "$origin" ]; then
    pass "git: no 'origin' remote (remotes stripped/neutralized)"
  elif printf '%s' "$origin" | grep -Eqi 'sreforge-gitea|gitea[:/]|//gitea|:3000|://[^/@]+:[^/@]+@'; then
    # Hard forge/rig tells: the forge container name, a gitea host, the forge
    # port (:3000), OR an embedded credential (user:pass@) — the substrate origin
    # is http://Mozzo1000:<token>@localhost:3000/..., which all three catch.
    fail "git: origin is an obvious forge/credential tell: $origin"
  elif printf '%s' "$origin" | grep -Eqi 'gitea|sreforge-forge|localhost|127\.0\.0\.1'; then
    warn "git: origin contains a soft forge/local hint (review): $origin"
  else
    pass "git: origin present and not an obvious forge tell: $origin"
  fi

  # Surface the full remote table for the operator's eye (informational).
  if [ -n "$remotes" ]; then
    printf '        remotes:\n'
    printf '%s\n' "$remotes" | sed 's/^/          /'
  fi
fi

# ===========================================================================
# Verdict
# ===========================================================================
hdr "VERDICT"
if [ "$FAILS" -eq 0 ]; then
  printf '  BOUNDARY OK — 0 failing checks. The ADR-0009 boundary holds.\n'
  exit 0
else
  printf '  BOUNDARY BREACHED — %d failing check(s). See FAIL lines above.\n' "$FAILS"
  exit 1
fi
