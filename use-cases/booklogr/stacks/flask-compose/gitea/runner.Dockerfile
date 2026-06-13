# act_runner with the tools host-mode CI needs. The upstream gitea/act_runner
# image is a bare Alpine + Go binary; in host mode (see runner-config.yaml) job
# steps run in THIS container, so it must carry:
#   - docker-cli : `docker build` in ci.yml, talking to the bind-mounted host socket
#   - git, node  : actions/checkout@v4 (a Node action)
#   - bash       : shell `run:` steps
FROM gitea/act_runner:latest
RUN apk add --no-cache docker-cli git nodejs bash
