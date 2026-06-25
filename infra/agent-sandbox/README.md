# agent-sandbox

The on-box environment a real **external** SRE agent is placed into to work the
booklogr incident: a single `agent-shell` container where it polls Alertmanager,
queries the observability stack (Prometheus / Grafana), reads the app, edits its
per-run workspace clone, and runs `submit`. Defined in [`agent.yml`](./agent.yml)
(compose project `sreforge-agent`) on the neutral image built by
[`agent-shell.Dockerfile`](./agent-shell.Dockerfile).

## Surface

The agent gets a shell, the documented HTTP endpoints, and `submit` — nothing else.

| env var            | endpoint                    | what it is                          |
|--------------------|-----------------------------|-------------------------------------|
| `API_URL`          | `http://booklogr-api:5000`  | the Flask app                       |
| `PROM_URL`         | `http://prometheus:9090`    | Prometheus query API + alerts       |
| `ALERTMANAGER_URL` | `http://alertmanager:9093`  | Alertmanager (firing alerts)        |
| `GRAFANA_URL`      | `http://grafana:3000`       | Grafana dashboards (internal port)  |

(This stack has no Loki, so no `LOKI_URL`.)

`agent-shell` joins **only** the deploy-plane network `booklogr_default`, has **no
docker socket and no docker CLI**, and mounts **only** the per-run workspace clone at
`/workspace`. It runs as a **non-root** user whose uid matches the workspace owner
(so git/file writes on the bind mount stay owner-consistent with the host engine).
The toolset (`curl`/`git`/`jq`) and the `submit` shim are **baked into the image**, so
there is no runtime install step and no single-file bind mount.

## submit — the engine handoff

`submit` (baked at `/usr/local/bin/submit`; `SUBMIT_CMD=submit`) is a handoff, not a
push. From `/workspace` it commits the agent's edits to a local branch and writes the
completion sentinel `/workspace/.sreforge/submit.json`. It contacts **no** forge and
**no** network — it only writes to `/workspace`. The host engine
(`ExternalAgentRunner`) watches the sentinel, captures the diff, and owns the forge
push / PR / CI. Select this mode with `AGENT_MODE=external` (or `RUNNER=external`) on
`run-incident.mjs`; the default remains the scripted runner.

## Bring it up and exec in

Prereq: the booklogr deploy plane is up (so the external network `booklogr_default`
exists):

```sh
use-cases/booklogr/stacks/flask-compose/scripts/up.sh
```

Prepare a per-run workspace clone, build the image for the host's uid/gid, and start
the sandbox (point `WORKSPACE_DIR` at the clone — an **absolute** path, **never** the
harness repo):

```sh
WS=$(use-cases/booklogr/stacks/flask-compose/scripts/prepare-agent-workspace.sh)
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) \
  -t ops-shell:1 -f infra/agent-sandbox/agent-shell.Dockerfile infra/agent-sandbox
AGENT_UID=$(id -u) AGENT_GID=$(id -g) WORKSPACE_DIR="$WS" \
  docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml up -d
```

Exec into the agent's world:

```sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml exec agent-shell sh
```

## Verify the boundary

From inside the sandbox, `scripts/verify-boundary.sh` asserts the agent-side
invariants (endpoints reachable; the harness does not resolve; no docker; the
workspace carries no forge/baseline tells):

```sh
docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-boundary.sh agent-shell:/tmp/vb.sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml exec agent-shell sh /tmp/vb.sh
```

Its positive counterpart, `scripts/verify-alert-pickup.sh`, asserts the agent can
do the on-call job the brief hands it: pick the firing alert up off Alertmanager
and query Prometheus for the signals behind it, with no rig tell in what it sees.
Pass `REQUIRE_FIRING=1` during an armed run to require the scenario's target alert:

```sh
docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-alert-pickup.sh agent-shell:/tmp/vap.sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -e REQUIRE_FIRING=1 agent-shell sh /tmp/vap.sh
```

Host-side, `scripts/verify-detell.sh` audits the deploy-plane containers (env /
labels / mounts / logs / image-clock) for leakage.

Tear down (the deploy plane is unaffected):

```sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml down
```

## Design notes

The boundary's threat model, the isolation-mechanism trade-offs, and the tracked
residuals live in the project's design notes, not here.
