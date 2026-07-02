#!/usr/bin/env bash
# =============================================================================
# verify-alert-pickup.sh — assert the agent can SELF-SERVE the incident FROM
# INSIDE the box. The positive counterpart to verify-boundary.sh.
#
# WHAT THIS IS
#   verify-boundary.sh proves the agent CANNOT see the rig (harness hidden).
#   This proves the agent CAN do the on-call job the brief hands it: pick the
#   firing alert up from the alerting stack and query on for the signals behind
#   it — exactly what the brief points it at, over the in-network endpoints it is
#   given. If this fails, the brief is writing a cheque the environment can't cash.
#
#   Checks (all run INSIDE the agent-shell container, agent's own vantage):
#     1. STACK ANSWERS  — Alertmanager + Prometheus answer over in-network DNS.
#     2. PICK UP        — Alertmanager /api/v2/alerts carries the scenario's TARGET
#                         alert (EXPECTED_ALERT), scoped to the service. (WARN if it
#                         is not firing, unless REQUIRE_FIRING is set — then a missing
#                         target alert is a FAIL: an armed run with nothing relevant
#                         to pick up is a broken run, even if some other alert fires.)
#     3. QUERY ON       — Prometheus query + rules APIs return real data, so the
#                         agent can pull the signals/thresholds behind the alert.
#     4. NO TELL        — nothing the agent reads off these endpoints leaks the
#                         rig (scenario / inject / baseline / answer-key / solution).
#
#   Exits NON-ZERO on ANY hard failure. Each check prints PASS / FAIL / WARN.
#
# HOW TO RUN  (mirrors verify-boundary.sh)
#   docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-alert-pickup.sh \
#     agent-shell:/tmp/verify-alert-pickup.sh
#   docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
#     exec -u "$(id -u):$(id -g)" agent-shell sh /tmp/verify-alert-pickup.sh
#
#   During an ARMED run (incident live), require a firing alert:
#     ... exec -u "$(id -u):$(id -g)" -e REQUIRE_FIRING=1 agent-shell sh /tmp/verify-alert-pickup.sh
#
# DEPENDENCY-LIGHT
#   curl (required) + jq (preferred; the agent-shell image ships it). Falls back
#   to grep-based parsing if jq is somehow absent, so the script still runs.
#   busybox ash honors `set -euo pipefail`.
# =============================================================================
set -euo pipefail

# ---- Config: in-network endpoints (the AGENT's view) -----------------------
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://alertmanager:9093}"
PROM_URL="${PROM_URL:-http://prometheus:9090}"
API_URL="${API_URL:-http://booklogr-api:5000}"
# The service the on-call owns — used to confirm the firing alert is scoped to it.
SERVICE="${SERVICE:-booklogr-api}"
# The alert the scenario arms (the harness PRIMARY_ALERT). Pickup is only truly
# exercised when THIS alert is firing — an unrelated active alert does not count,
# so REQUIRE_FIRING is gated on this name, not on the global active-alert count.
EXPECTED_ALERT="${EXPECTED_ALERT:-BooklogrApiLatencyP99High}"
# When truthy, a missing EXPECTED_ALERT is a FAIL (use during an armed run). Default
# off: reachability + query capability are still proven and pickup is a WARN. Accept
# the common truthy spellings so REQUIRE_FIRING=true|yes|on also arm it, not only "1".
case "$(printf '%s' "${REQUIRE_FIRING:-0}" | tr '[:upper:]' '[:lower:]')" in
  1 | true | yes | on) REQUIRE_FIRING=1 ;;
  *) REQUIRE_FIRING=0 ;;
esac

CONNECT_TIMEOUT=3
MAX_TIME=8

# Harness tells that must NOT appear in anything the agent reads off the stack.
# Hard tells FAIL the run; soft hints only WARN. Pure-rig terms (sreforge, harness,
# inject-regression, …) are HARD — they have no product-legitimate use, so reaching
# an agent-visible payload is a real leak. Tokens that could plausibly be product/SRE
# legitimate ("baseline latency", a runbook "scenario") stay SOFT to avoid false trips.
HARD_TELLS='sreforge|answer.?key|/solution/|inject-regression|fault-inject|harness'
SOFT_TELLS='scenario|baseline'

# ---- Result tracking -------------------------------------------------------
FAILS=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  WARN  %s\n' "$1"; }
hdr()  { printf '\n== %s ==\n' "$1"; }

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1

# curl wrapper: silent, timeout-bounded; body on stdout, caller checks exit.
cget() {
  curl -fsS --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$@"
}

# ===========================================================================
# 1. STACK ANSWERS — the pickup surface is reachable over in-network DNS.
# ===========================================================================
hdr "1. STACK ANSWERS (alerting + metrics reachable by service DNS)"

AM_ALERTS=""
if AM_ALERTS="$(cget "$ALERTMANAGER_URL/api/v2/alerts" 2>/dev/null)"; then
  pass "Alertmanager API: GET $ALERTMANAGER_URL/api/v2/alerts answered"
else
  fail "Alertmanager API: $ALERTMANAGER_URL/api/v2/alerts unreachable — agent cannot pick up alerts"
fi

PROM_ALERTS=""
if PROM_ALERTS="$(cget "$PROM_URL/api/v1/alerts" 2>/dev/null)"; then
  pass "Prometheus alerts API: GET $PROM_URL/api/v1/alerts answered"
else
  fail "Prometheus alerts API: $PROM_URL/api/v1/alerts unreachable"
fi

# ===========================================================================
# 2. PICK UP — the firing alert is visible to the agent, scoped to the service.
# ===========================================================================
hdr "2. PICK UP (firing alert visible off Alertmanager, scoped to service)"

active_count=0
active_names=""
active_has_service=0
expected_firing=0
if [ -n "$AM_ALERTS" ]; then
  if [ "$have_jq" -eq 1 ]; then
    active_count="$(printf '%s' "$AM_ALERTS" | jq '[.[] | select(.status.state=="active")] | length' 2>/dev/null || echo 0)"
    active_names="$(printf '%s' "$AM_ALERTS" | jq -r '[.[] | select(.status.state=="active") | .labels.alertname] | unique | join(", ")' 2>/dev/null || echo "")"
    # Does any ACTIVE alert carry the service label scoping it to this on-call?
    if printf '%s' "$AM_ALERTS" | jq -e --arg s "$SERVICE" '[.[] | select(.status.state=="active") | .labels.service // empty] | index($s)' >/dev/null 2>&1; then
      active_has_service=1
    fi
    # Is the scenario's TARGET alert among the active ones? (the real pickup signal)
    if printf '%s' "$AM_ALERTS" | jq -e --arg a "$EXPECTED_ALERT" '[.[] | select(.status.state=="active") | .labels.alertname] | index($a)' >/dev/null 2>&1; then
      expected_firing=1
    fi
  else
    # jq-less fallback: count active states textually (Alertmanager nests state).
    # Wrap grep so a no-match (exit 1) does not trip set -e/pipefail on this bare
    # assignment — the off-incident path must reach the verdict, not abort.
    active_count="$(printf '%s' "$AM_ALERTS" | { grep -o '"state"[[:space:]]*:[[:space:]]*"active"' || true; } | wc -l | tr -d ' ')"
    # Heuristic only: without jq we cannot bind a label to a specific active alert
    # object, so only trust the service/target-alert match when SOMETHING is active.
    if [ "${active_count:-0}" -ge 1 ] 2>/dev/null; then
      printf '%s' "$AM_ALERTS" | grep -q "\"service\"[[:space:]]*:[[:space:]]*\"$SERVICE\"" && active_has_service=1
      printf '%s' "$AM_ALERTS" | grep -q "\"alertname\"[[:space:]]*:[[:space:]]*\"$EXPECTED_ALERT\"" && expected_firing=1
    fi
  fi
fi

if [ "${active_count:-0}" -ge 1 ] 2>/dev/null; then
  pass "firing alerts visible: ${active_count} active${active_names:+ ($active_names)}"
  # The armed scenario targets ONE alert. Pickup is genuinely exercised only when
  # THAT alert is active — an unrelated active alert must not pass an armed run.
  if [ "$expected_firing" -eq 1 ]; then
    pass "target alert firing: $EXPECTED_ALERT is active (the armed scenario's signal)"
  elif [ "$REQUIRE_FIRING" = "1" ]; then
    fail "target alert $EXPECTED_ALERT is NOT active but REQUIRE_FIRING set — the armed run's signal isn't firing (agent has nothing relevant to pick up)"
  else
    warn "target alert $EXPECTED_ALERT not active (active: ${active_names:-none}) — arm the target incident (REQUIRE_FIRING=1) to exercise real pickup"
  fi
  if [ "$active_has_service" -eq 1 ]; then
    pass "alert scoped to service: an active alert carries service=$SERVICE (agent can correlate)"
  else
    warn "no active alert carries service=$SERVICE — agent must infer scope from alertname/labels"
  fi
else
  if [ "$REQUIRE_FIRING" = "1" ]; then
    fail "no firing alert in Alertmanager but REQUIRE_FIRING set — armed run has nothing for the agent to pick up"
  else
    warn "no alert currently firing — reachability proven, but arm the incident (REQUIRE_FIRING=1) to exercise real pickup"
  fi
fi

# ===========================================================================
# 3. QUERY ON — Prometheus query + rules APIs return real data.
# ===========================================================================
hdr "3. QUERY ON (agent can pull the signals + thresholds behind the alert)"

# Instant query: proves PromQL works and metrics are actually flowing.
q="$(cget "$PROM_URL/api/v1/query?query=up" 2>/dev/null || true)"
if [ "$have_jq" -eq 1 ]; then
  qstatus="$(printf '%s' "$q" | jq -r '.status // "?"' 2>/dev/null || echo "?")"
  qseries="$(printf '%s' "$q" | jq '.data.result | length' 2>/dev/null || echo 0)"
else
  qstatus="$(printf '%s' "$q" | grep -q '"status"[[:space:]]*:[[:space:]]*"success"' && echo success || echo "?")"
  qseries="$(printf '%s' "$q" | { grep -o '"metric"' || true; } | wc -l | tr -d ' ')"
fi
if [ "$qstatus" = "success" ] && [ "${qseries:-0}" -ge 1 ] 2>/dev/null; then
  pass "PromQL works: query=up -> success, ${qseries} series scraped (metrics are live)"
elif [ "$qstatus" = "success" ]; then
  warn "PromQL query=up succeeded but returned 0 series — metrics may not be flowing yet"
else
  fail "PromQL query API did not succeed ($PROM_URL/api/v1/query?query=up)"
fi

# Rules API: the agent reads the alerting rule (expr + threshold) from here.
rules="$(cget "$PROM_URL/api/v1/rules" 2>/dev/null || true)"
if [ "$have_jq" -eq 1 ]; then
  alerting_rules="$(printf '%s' "$rules" | jq '[.data.groups[].rules[]? | select(.type=="alerting")] | length' 2>/dev/null || echo 0)"
else
  alerting_rules="$(printf '%s' "$rules" | { grep -o '"type"[[:space:]]*:[[:space:]]*"alerting"' || true; } | wc -l | tr -d ' ')"
fi
if [ "${alerting_rules:-0}" -ge 1 ] 2>/dev/null; then
  pass "rules API: ${alerting_rules} alerting rule(s) readable (agent can see expr + threshold)"
else
  fail "rules API: no alerting rules readable at $PROM_URL/api/v1/rules"
fi

# Light: the service under investigation is at least TCP-reachable for the agent
# to probe directly. It is mid-incident (slow/erroring), so non-2xx is fine.
acode="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$API_URL/" 2>/dev/null || true)"
if [ -n "$acode" ] && [ "$acode" != "000" ]; then
  pass "service reachable: GET $API_URL/ -> HTTP $acode (agent can probe it directly)"
else
  warn "service $API_URL/ HTTP-silent — likely saturated by the incident (reachability via metrics still holds)"
fi

# ===========================================================================
# 4. NO TELL — nothing the agent reads off the stack leaks the rig.
# ===========================================================================
hdr "4. NO TELL (agent-visible payloads carry no harness tell)"

# Everything the agent reads by self-serving: both alert payloads, the rules dump,
# AND the instant-query result it pulls in check 3 ($q) — scan all of it.
visible="$(printf '%s\n%s\n%s\n%s\n' "$AM_ALERTS" "$PROM_ALERTS" "$rules" "$q")"
if printf '%s' "$visible" | grep -Eiq "$HARD_TELLS"; then
  fail "hard rig tell in agent-visible payload:"
  printf '%s' "$visible" | grep -Eio "$HARD_TELLS" | sort -u | sed 's/^/        /'
elif printf '%s' "$visible" | grep -Eiq "$SOFT_TELLS"; then
  warn "soft hint in agent-visible payload (review — may be product-legitimate):"
  printf '%s' "$visible" | grep -Eio "$SOFT_TELLS" | sort -u | sed 's/^/        /'
else
  pass "no harness tell in alerts/rules payloads (self-serving does not expose the rig)"
fi

# ===========================================================================
# Verdict
# ===========================================================================
hdr "VERDICT"
if [ "$FAILS" -eq 0 ]; then
  printf '  PICKUP OK — 0 failing checks. The agent can self-serve the incident.\n'
  exit 0
else
  printf '  PICKUP BROKEN — %d failing check(s). See FAIL lines above.\n' "$FAILS"
  exit 1
fi
