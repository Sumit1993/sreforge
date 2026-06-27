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

# Toolset baked at BUILD time (not container start): the responder's shell kit.
RUN apk add --no-cache curl git jq ca-certificates

# The submit handoff, baked onto PATH (no bind mount). Read-only by virtue of
# being an image layer; the agent cannot tamper with it without rebuilding.
COPY scripts/submit /usr/local/bin/submit
RUN chmod +x /usr/local/bin/submit

# Run as a NON-ROOT user — the responder is not root-in-box for routine work, and
# matching the per-run workspace owner keeps every git/file write on the bind mount
# owner-consistent with the host engine (root-in-container would create root-owned
# git objects the host engine, running as the invoking user, could not then manage).
# UID/GID are build-configurable so the image matches the host workspace owner on
# any box (build with --build-arg UID=$(id -u) GID=$(id -g); defaults suit a uid-1000
# dev box). A real passwd/group entry for the runtime uid keeps shell tooling
# (whoami, prompts, git) behaving like a normal login — a uid with no passwd entry
# is itself a small tell. `safe.directory *` is a uid-agnostic backstop. All folded
# into one layer to keep docker-history surface minimal. agent.yml's `user:` selects
# the runtime uid (must match this build's UID, i.e. the host owner).
ARG UID=1000
ARG GID=1000
RUN addgroup -g "${GID}" dev && adduser -D -u "${UID}" -G dev dev \
 && git config --system --add safe.directory '*'
USER dev

# Long-running so an external agent can be exec'd in at any time. (Compose does
# not override this; see agent.yml — the `command:` was removed with the apk step.)
CMD ["sleep", "infinity"]
