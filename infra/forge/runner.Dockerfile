# act_runner with the tools host-mode CI needs. The upstream gitea/act_runner
# image is a bare Alpine + Go binary; in host mode (see runner-config.yaml) job
# steps run in THIS container, so it must carry:
#   - docker-cli : `docker build` in ci.yml, talking to the bind-mounted host socket
#   - git, node  : actions/checkout@v4 (a Node action)
#   - bash       : shell `run:` steps
FROM gitea/act_runner:latest
RUN apk add --no-cache docker-cli git nodejs bash

# Bake the runner config into the image instead of bind-mounting it from the
# host. On WSL2 + Rancher Desktop a single-FILE bind (runner-config.yaml
# -> /config.yaml) is staged through the docker-mounts shim and resolves as a
# directory, so the bind fails ("mount a directory onto a file") and the runner
# cannot be recreated after a host cycle — same root cause as the Gitea tz mounts.
# CONFIG_FILE=/config.yaml (infra/forge/forge.yml) points at this baked-in copy.
# NOTE: editing runner-config.yaml now requires rebuilding this image.
COPY runner-config.yaml /config.yaml
