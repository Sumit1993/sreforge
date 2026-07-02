#!/usr/bin/env bash
# =============================================================================
# verify-egress.sh — assert the default-deny EGRESS boundary FROM INSIDE the box.
#
# WHAT THIS IS
#   Companion to verify-boundary.sh. The agent sandbox now seals outbound traffic
#   to a default-deny allowlist (infra/agent-sandbox/init-firewall.sh). This script
#   runs INSIDE agent-shell, as the NON-root agent, and proves:
#     1. INTRA-PLANE OPEN — the deploy-plane services (Prometheus / Alertmanager /
#        Grafana / app) are still reachable (the firewall allows the private
#        ranges). The agent must keep its on-call surface.
#     2. EXTERNAL SEALED  — known external hosts (github.com, pypi.org) do NOT
#        answer (the retrieval hole is closed). A reply here is a LEAK.
#     3. DNS WORKS        — names still resolve (DNS is allowed even though the
#        connection is dropped), so service-DNS keeps working.
#     4. ALLOWLIST (opt)  — if EXPECT_ALLOWED is passed (comma/space hosts), each
#        MUST connect (proves a cloud run's provider was allowlisted).
#
#   Exits NON-ZERO on any leak. Each check prints PASS / FAIL / WARN.
#
#   NOTE: run as the non-root agent (`exec -u $(id -u):$(id -g)`). The agent
#   cannot read the iptables counters — that is correct; the operator reads the
#   EGRESS_BLOCKED counter via a ROOT exec:
#     docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
#       exec -u 0 agent-shell iptables -nvL EGRESS_BLOCKED
#
# HOW TO RUN  (the Taskfile `verify:egress` does this for you)
#   docker cp scripts/verify-egress.sh agent-shell:/tmp/ve.sh
#   docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
#     exec -u "$(id -u):$(id -g)" agent-shell sh /tmp/ve.sh
#
# DEPENDENCY-LIGHT: curl only (baked in). busybox ash honours set -euo pipefail.
# =============================================================================
set -euo pipefail

# ---- Config ----------------------------------------------------------------
PROM_URL="${PROM_URL:-http://prometheus:9090}"
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://alertmanager:9093}"

# Hosts that MUST be blocked (the retrieval surface). Override with EXPECT_BLOCKED.
EXPECT_BLOCKED="${EXPECT_BLOCKED:-github.com pypi.org}"
# Hosts that MUST connect (a cloud run's allowlisted provider). Empty by default
# (the zero-egress posture has nothing to allow). Passed per-exec by the operator.
EXPECT_ALLOWED="${EXPECT_ALLOWED:-}"

CONNECT_TIMEOUT=3
MAX_TIME=8

FAILS=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  WARN  %s\n' "$1"; }
hdr()  { printf '\n== %s ==\n' "$1"; }

cget() { curl -fsS --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$@"; }
# HTTP status only; "000" (or empty) means no answer (connect failed / DROP).
ccode() {
  curl -s -o /dev/null -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$1" 2>/dev/null || true
}

# ===========================================================================
hdr "1. INTRA-PLANE OPEN (deploy-plane services must still answer)"
# ===========================================================================
if cget "$PROM_URL/-/ready" >/dev/null 2>&1; then
  pass "Prometheus reachable: $PROM_URL/-/ready (intra-plane allow works)"
else
  fail "Prometheus UNREACHABLE: $PROM_URL/-/ready — firewall over-blocked the deploy plane"
fi
if cget "$ALERTMANAGER_URL/-/healthy" >/dev/null 2>&1; then
  pass "Alertmanager reachable: $ALERTMANAGER_URL/-/healthy"
else
  fail "Alertmanager UNREACHABLE: $ALERTMANAGER_URL/-/healthy — firewall over-blocked the deploy plane"
fi

# ===========================================================================
hdr "2. EXTERNAL SEALED (retrieval hosts must NOT answer)"
# ===========================================================================
for h in $EXPECT_BLOCKED; do
  code="$(ccode "https://$h")"
  if [ -z "$code" ] || [ "$code" = "000" ]; then
    pass "egress blocked: https://$h -> no response (DROP/timeout)"
  else
    fail "egress LEAK: https://$h -> HTTP $code (reachable — retrieval hole open!)"
  fi
done

# ===========================================================================
hdr "3. DNS WORKS (names resolve even though the connection is dropped)"
# ===========================================================================
# DNS is allowed; resolution succeeds while the TCP connect is DROPped. Use the
# resolver tools that exist on alpine; fall back to curl's exit-6 (could-not-resolve).
dns_ok() {
  name="$1"
  if command -v getent >/dev/null 2>&1; then getent hosts "$name" >/dev/null 2>&1
  elif command -v nslookup >/dev/null 2>&1; then nslookup "$name" >/dev/null 2>&1
  else
    rc=0; curl -s --connect-timeout 2 --max-time 3 "http://$name/" >/dev/null 2>&1 || rc=$?
    [ "$rc" -ne 6 ]
  fi
}
if dns_ok prometheus; then
  pass "DNS resolves service name: prometheus"
else
  fail "DNS broken: 'prometheus' does not resolve — embedded resolver was blocked"
fi

# ===========================================================================
hdr "4. ALLOWLIST (optional — only when EXPECT_ALLOWED is set)"
# ===========================================================================
if [ -n "$EXPECT_ALLOWED" ]; then
  for h in $(printf '%s' "$EXPECT_ALLOWED" | tr ',' ' '); do
    [ -n "$h" ] || continue
    code="$(ccode "https://$h")"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      pass "allowlisted reachable: https://$h -> HTTP $code"
    else
      fail "allowlisted host BLOCKED: https://$h -> no response (should connect)"
    fi
  done
else
  printf '  N/A   no EXPECT_ALLOWED set (zero-egress posture; nothing to allow)\n'
fi

# ===========================================================================
hdr "VERDICT"
# ===========================================================================
if [ "$FAILS" -eq 0 ]; then
  printf '  EGRESS OK — 0 failing checks. Default-deny holds.\n'
  exit 0
else
  printf '  EGRESS BREACHED — %d failing check(s). See FAIL lines above.\n' "$FAILS"
  exit 1
fi
