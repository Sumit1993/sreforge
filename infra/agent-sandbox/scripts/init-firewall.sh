#!/bin/sh
# =============================================================================
# init-firewall.sh — default-deny EGRESS allowlist for the agent sandbox.
#
# WHY THIS EXISTS
#   agent-shell attaches to the use-case deploy-plane bridge, which has NAT — so
#   without this, the agent has FULL open outbound internet and could fetch the
#   answer (github / the public upstream app / package registries / search).
#   That is a retrieval-isolation hole. This script seals egress to DEFAULT-DENY
#   and re-opens ONLY: loopback, established replies, the embedded DNS resolver,
#   the private (intra-plane) ranges, and an explicit provider allowlist.
#
# OFF-THE-SHELF, INVERTED
#   This is the Claude Code devcontainer firewall pattern (iptables + ipset),
#   INVERTED: that allowlist lets github/npm IN; ours keeps them OUT by default.
#   No proxy, no HTTPS_PROXY env var (that would be a tell).
#
# RUN AS ROOT, BEFORE PRIVILEGE DROP
#   entrypoint.sh runs this as root (needs CAP_NET_ADMIN), then drops to the
#   non-root agent uid. The agent therefore has NO effective caps and CANNOT
#   flush or inspect these rules (iptables/ipset return EPERM for non-root).
#
# FAIL CLOSED
#   `set -eu`: any failure aborts the entrypoint -> the container restart-loops
#   and never serves with an open network. A half-applied firewall is never a
#   silently-open one.
#
# DE-TELL
#   Default policy is DROP (silent timeout = "no route"), never REJECT — a
#   blocked reach looks like the unrouted harness hosts, not a loud filter.
#   Blocked attempts are counted on the EGRESS_BLOCKED chain (operator reads the
#   counter via a root `exec`; the non-root agent cannot). We deliberately do NOT
#   use the kernel LOG target: dmesg_restrict=0 on WSL2 and the kernel ring
#   buffer is not network-namespaced, so the agent could read LOG lines.
#
# BACKEND (auto-detected)
#   Prefer `iptables-legacy` if the distro ships it (Debian); else fall back to the
#   nft-backed `iptables` (Alpine ships ONLY nft — `iptables` -> xtables-nft-multi).
#   The nft backend works here via nf_tables (built-in) + nft_compat for the xt
#   matches we use (-m set / -m state / -m limit), verified on this WSL2 kernel.
#
# IDEMPOTENT
#   Re-runnable: own filter chains + the ipset are flushed/recreated. The `nat`
#   table is NEVER touched — Docker's embedded resolver (127.0.0.11) depends on a
#   nat DNAT, and flushing nat silently breaks DNS.
# =============================================================================
set -eu

# Serialize concurrent runs. Rebuilding the chains is not atomic, and two
# interleaved runs (the boot entrypoint vs an operator's allowlist re-apply
# exec) can flush each other's rules mid-build — the self-test then fails
# closed and the container restart-loops, killing the exec. One run at a time;
# last writer wins. (Env, incl. EGRESS_ALLOWLIST/WEBHOOK_PORT, survives the
# re-exec.)
LOCK=/run/.init-firewall.lock
if [ "${FLOCKED:-}" != "$LOCK" ]; then
  FLOCKED="$LOCK" exec flock "$LOCK" "$0" "$@"
fi

# Backend: prefer the legacy binary if a distro ships it, else the nft-backed one.
IPT="$(command -v iptables-legacy 2>/dev/null || command -v iptables || true)"
IPT6="$(command -v ip6tables-legacy 2>/dev/null || command -v ip6tables || true)"
SET="allowed-domains"

# Provider allowlist: comma/space-separated domains. EMPTY ⇒ zero external
# egress (the benchmark default; cloud runs opt in by naming their provider).
EGRESS_ALLOWLIST="${EGRESS_ALLOWLIST:-}"

log() { printf 'init-firewall: %s\n' "$1" >&2; }

# ---- Preflight: the tools must exist (fail closed if not) -------------------
[ -n "$IPT" ]  || { log "FATAL: no iptables binary found";  exit 1; }
[ -n "$IPT6" ] || { log "FATAL: no ip6tables binary found"; exit 1; }
command -v ipset >/dev/null 2>&1 || { log "FATAL: ipset not found"; exit 1; }

# ===========================================================================
# IPv4
# ===========================================================================

# Default-deny FIRST so a mid-script abort fails closed. The script's only
# outbound need (DNS for allowlist resolution) is permitted below before it runs.
$IPT -P INPUT   DROP
$IPT -P FORWARD DROP
$IPT -P OUTPUT  DROP

# Idempotency: clear our own rules without touching `nat`.
$IPT -F INPUT
$IPT -F OUTPUT
$IPT -F FORWARD

# Loopback (also covers the 127.0.0.11 DNAT path, which lands on lo).
$IPT -A INPUT  -i lo -j ACCEPT
$IPT -A OUTPUT -o lo -j ACCEPT

# Established/related replies, both directions.
$IPT -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
$IPT -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Webhook-trigger pinhole (ADR-0025): the use-case's Alertmanager POSTs the
# firing notification to this box (the `oncall` alias, agent.yml) — the box
# "registers" by listening. ONE deliberate inbound allow: TCP to the webhook
# port from the private (intra-plane) ranges only. Everything else on INPUT
# stays default-deny; new-outbound is untouched. WEBHOOK_PORT is an
# entrypoint-side env (never set in the agent's container environment).
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  $IPT -A INPUT -p tcp -s "$net" --dport "${WEBHOOK_PORT:-8080}" -j ACCEPT
done

# Docker embedded DNS resolver (belt-and-suspenders alongside the lo rule).
$IPT -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
$IPT -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT

# Intra-plane reach: the private ranges. The agent's only routable private
# neighbours are this use-case's deploy plane (app + observability) and the
# bridge gateway; the forge/load planes live on networks agent-shell is not
# attached to, so they stay unrouted regardless of this ACCEPT. External traffic
# carries a PUBLIC destination IP, so it never matches these and falls through to
# the allowlist / DROP. (Simpler and more WSL-robust than parsing on-link routes,
# and it auto-covers a multi-network use-case.)
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  $IPT -A OUTPUT -d "$net" -j ACCEPT
done

# Provider allowlist via ipset. DNS is permitted above, so resolve now. Prefer dig
# (bind-tools) for deterministic one-IP-per-line A records; getent as a fallback.
resolve_ipv4() {
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$1" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true
  elif command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u || true
  fi
}
ipset create "$SET" hash:net family inet -exist
ipset flush  "$SET"
ndoms=0
for d in $(printf '%s' "$EGRESS_ALLOWLIST" | tr ',' ' '); do
  [ -n "$d" ] || continue
  ndoms=$((ndoms + 1))
  got=0
  ips="$(resolve_ipv4 "$d")"
  for ip in $ips; do
    if ipset add "$SET" "$ip" -exist 2>/dev/null; then got=1; fi
  done
  if [ "$got" -eq 1 ]; then log "allow $d"; else log "WARN: '$d' did not resolve to IPv4"; fi
done
# Allow web ports to the resolved allowlist (two rules — no multiport dependency).
# Empty allowlist ⇒ empty set ⇒ this never matches ⇒ zero external egress.
$IPT -A OUTPUT -p tcp -m set --match-set "$SET" dst --dport 80  -j ACCEPT
$IPT -A OUTPUT -p tcp -m set --match-set "$SET" dst --dport 443 -j ACCEPT

# Cheat-signal: everything not accepted above hits EGRESS_BLOCKED — its packet
# counter is the operator's "the agent tried to reach out" signal. NFLOG is
# best-effort (a host collector may listen on group 1); the DROP + its counter
# are the durable signal. NOT the kernel LOG target (agent-readable on WSL2).
$IPT -N EGRESS_BLOCKED 2>/dev/null || $IPT -F EGRESS_BLOCKED
$IPT -A EGRESS_BLOCKED -m limit --limit 10/min -j NFLOG --nflog-group 1 --nflog-prefix "EGRESS-BLOCK " 2>/dev/null || true
$IPT -A EGRESS_BLOCKED -j DROP
$IPT -A OUTPUT -j EGRESS_BLOCKED

# ===========================================================================
# IPv6 — full default-deny (no v6 allowlist). The deploy plane is IPv4 today;
# this is cheap insurance against an IPv6-enabled network leaking past the v4
# filter. Fail closed if ip6tables is unusable rather than leave v6 open.
# ===========================================================================
$IPT6 -P INPUT   DROP
$IPT6 -P FORWARD DROP
$IPT6 -P OUTPUT  DROP
$IPT6 -F INPUT
$IPT6 -F OUTPUT
$IPT6 -F FORWARD
$IPT6 -A INPUT  -i lo -j ACCEPT
$IPT6 -A OUTPUT -o lo -j ACCEPT
$IPT6 -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
$IPT6 -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# ===========================================================================
# Self-test — prove the firewall actually took, else fail closed.
# ===========================================================================
$IPT -S OUTPUT | grep -q '^-P OUTPUT DROP'        || { log "FATAL: OUTPUT policy is not DROP"; exit 1; }
$IPT -S OUTPUT | grep -q -- '--match-set '"$SET"' dst' || { log "FATAL: allowlist match rule missing"; exit 1; }
$IPT6 -S OUTPUT | grep -q '^-P OUTPUT DROP'       || { log "FATAL: IPv6 OUTPUT policy is not DROP"; exit 1; }

log "egress sealed (default-deny); allowlist domains: ${ndoms}"
