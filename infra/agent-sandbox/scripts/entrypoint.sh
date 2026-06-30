#!/bin/sh
# =============================================================================
# entrypoint.sh — set the egress firewall as root, then become the non-root agent.
#
# The container starts as root (no compose `user:`) SOLELY so this script can set
# the iptables/ipset egress allowlist (needs CAP_NET_ADMIN). It then drops to the
# baked non-root `dev` user via su-exec and execs the long-running CMD. The agent
# the operator later `docker exec`s in (with `-u`) is likewise non-root, so it has
# NO effective caps and CANNOT flush or inspect the firewall (EPERM). Privilege
# exists only for the brief root phase; after `exec`, ps shows only `dev`.
#
# FAIL CLOSED: `set -eu` + init-firewall.sh's own checks mean any failure to seal
# egress aborts here, so the container restart-loops and never serves open. At
# boot the allowlist is EMPTY ⇒ zero external egress (the default posture). A
# cloud run re-applies the firewall with its provider via a root `docker exec -e`
# (see the use-case `agent` task) — passed per-exec so it is NOT stored in the
# container env and therefore NEVER visible to the agent (a de-tell).
#
# DE-TELL: nothing here puts firewall config into the container's environment or
# `user:` directive, so an agent that runs `env` sees only the normal responder
# endpoints (PROM_URL/…), never an allowlist var. Dropping to `dev` keeps the
# blocked-egress story "this box has a corp firewall", not "this box is staged".
# =============================================================================
set -eu

[ "$(id -u)" = "0" ] || {
  echo "entrypoint: must start as root to set the egress firewall (got uid $(id -u))" >&2
  exit 1
}

/usr/local/sbin/init-firewall.sh

exec su-exec dev "$@"
