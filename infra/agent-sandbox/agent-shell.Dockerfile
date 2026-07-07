# =============================================================================
# agent-shell image — the neutral, pre-baked world the EXTERNAL SRE agent lives in.
#
# WHY A BAKED IMAGE (not inline `apk add` + a bind-mounted shim):
#   1. NO runtime install step. Installing curl/git/jq at container start is an
#      observable action (process table, shell history, apk logs) and couples the
#      sandbox to apk-repo egress. Baking removes that surface entirely.
#   2. NO single-file bind mount. The `submit` shim was bind-mounted at
#      /usr/local/bin/submit, which (a) shows up in /proc/mounts as a lone bind —
#      itself a tell — and (b) is BROKEN on WSL2 + Rancher Desktop, which stages a
#      single-file host bind through its docker-mounts shim and resolves it as a
#      DIRECTORY ("mount ...: not a directory"), so the container cannot start.
#      (Same caveat infra/forge/runner.Dockerfile documents for runner-config.yaml.)
#      Baking the shim into the image sidesteps both.
#
# DE-TELL: neutral base, no harness vocabulary in image name / layers / labels.
# The agent has no docker in the minimal sandbox, so image metadata is not
# agent-visible yet; it becomes a surface only once the scoped-real docker view
# lands (see README.md → deferred layers). Keep this image's history coherent
# then (pin the base by digest; minimise layers) — tracked as a residual.
# =============================================================================
FROM alpine:3.20

# Toolset baked at BUILD time (not container start): the responder's shell kit,
# plus the egress-firewall tooling (iptables/ip6tables/ipset) and su-exec for the
# root-sets-firewall-then-drops-privileges entrypoint. Baking (vs a runtime
# `apk add`) keeps the install off the process table and avoids apk-repo egress —
# which the firewall would now block anyway.
# nodejs: runtime for the in-box agent loop; node on an ops box is unremarkable
RUN apk add --no-cache curl git jq ca-certificates iptables ip6tables ipset su-exec bind-tools nodejs

# The submit handoff, baked onto PATH (no bind mount). Read-only by virtue of
# being an image layer; the agent cannot tamper with it without rebuilding.
COPY scripts/submit /usr/local/bin/submit
RUN chmod +x /usr/local/bin/submit

# The in-box agent loop — world-readable (the agent's own tooling, honest per
# ADR-0008 — no hiding).
COPY runtime/agent-loop.mjs /usr/local/lib/agent-loop.mjs

# The egress firewall + the privilege-drop entrypoint. Installed to /usr/local/sbin,
# root-owned and chmod 700: the non-root agent cannot read the firewall logic (a
# de-tell — the script names the deploy-plane reasoning + the allowlist mechanism)
# and cannot run it (no caps anyway). entrypoint.sh runs as root at container
# start, seals egress, then su-exec's down to `dev`.
COPY scripts/entrypoint.sh scripts/init-firewall.sh /usr/local/sbin/
RUN chmod 700 /usr/local/sbin/entrypoint.sh /usr/local/sbin/init-firewall.sh

# Create the non-root `dev` user/group whose uid/gid match the host workspace
# owner, so git/file writes on the /workspace bind mount stay owner-consistent
# with the host engine (root-in-container would create root-owned git objects the
# host engine, running as the invoking user, could not then manage). UID/GID are
# build-configurable so the image matches the host workspace owner on any box
# (build with --build-arg UID=$(id -u) GID=$(id -g); defaults suit a uid-1000 dev
# box). A real passwd/group entry keeps shell tooling (whoami, prompts, git)
# behaving like a normal login — a uid with no passwd entry is itself a small tell.
# `safe.directory *` is a uid-agnostic backstop.
#
# We deliberately do NOT `USER dev`. The container must START as root so
# entrypoint.sh can set the egress firewall (needs CAP_NET_ADMIN); it then
# su-exec's down to `dev` for the long-running process, so ps shows only `dev`.
# Consequence: the container's CONFIGURED user is root, so every `docker exec` that
# drops the agent in MUST pass `-u $(id -u):$(id -g)` — otherwise it lands as root
# and could flush the rules. The use-case Taskfile + README do this.
ARG UID=1000
ARG GID=1000
RUN addgroup -g "${GID}" dev && adduser -D -u "${UID}" -G dev dev \
 && git config --system --add safe.directory '*'

# entrypoint seals egress as root, then su-exec's to `dev` and execs CMD.
ENTRYPOINT ["/usr/local/sbin/entrypoint.sh"]
# Long-running so an external agent can be exec'd in at any time.
CMD ["sleep", "infinity"]
