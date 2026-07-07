# agent-sandbox

The on-box environment a real **external** SRE agent is placed into to work a
use-case's incident (booklogr shown below). It is **use-case-neutral**: the
deploy-plane network and app endpoint are passed in (`DEPLOY_NETWORK`, `API_URL`),
so the same sandbox serves any use-case. The engine/operator execs the agent's
process **into** the already-running `agent-shell` container (the agent has no
docker access of its own); inside, it polls Alertmanager, queries the
observability stack (Prometheus / Grafana), reads the app, edits its per-run
workspace clone, and runs `submit`. Defined in [`agent.yml`](./agent.yml) (compose
project `sreforge-agent`) on the neutral image built by
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

`agent-shell` mounts **only** the per-run workspace clone at `/workspace`, has **no
docker socket and no docker CLI**, and the toolset (`curl`/`git`/`jq`) and the
`submit` shim are **baked into the image** (no runtime install, no single-file bind).

**Two isolation layers:**

1. **Lateral — by omission.** Only the deploy-plane network (`DEPLOY_NETWORK`,
   booklogr's is `booklogr_default`) is joined, so the forge/load planes are simply
   unrouted — nothing to detect.
2. **Egress — default-deny allowlist.** The deploy-plane bridge has NAT, so without
   a firewall the box would have open internet (a retrieval hole: github / the
   public upstream app / registries / search). The container's **root entrypoint**
   runs `init-firewall.sh` (iptables + ipset, legacy backend) to seal outbound to
   the intra-plane (private) ranges + an explicit provider allowlist
   (`EGRESS_ALLOWLIST`, **empty by default ⇒ zero external egress**), then
   **su-exec's down to the non-root `dev` user**. The non-root agent cannot flush or
   inspect the rules. A blocked reach is a **DROP** (silent timeout, looks like "no
   route") and is counted on the `EGRESS_BLOCKED` chain as a cheat-signal. It fails
   **closed** — if the firewall can't be set, the container restart-loops rather
   than serve with open egress.
   **Inbound** has exactly **one pinhole** (ADR-0025): TCP `:8080` from the
   private ranges — the box's `oncall` network alias is where the use-case's
   Alertmanager posts the firing notification (the automated trigger,
   `pnpm forge auto <use-case>`). The box "registers" by listening; every other
   inbound port stays default-deny (`verify:webhook` probes both directions).

> Because the container starts as **root** (so the entrypoint can program the
> firewall), its *configured* user is root — so every `docker exec` below passes
> **`-u "$(id -u):$(id -g)"`** to run as the non-root agent. An exec without `-u`
> lands as root and could flush the firewall.

## submit — the engine handoff

`submit` (baked at `/usr/local/bin/submit`; `SUBMIT_CMD=submit`) is a handoff, not a
push. From `/workspace` it commits the agent's edits to a local branch and writes the
completion sentinel `/workspace/.sreforge/submit.json`. It contacts **no** forge and
**no** network — it only writes to `/workspace`. The host engine
(`ExternalAgentRunner`) watches the sentinel, captures the diff, and owns the forge
push / PR / CI. Select this mode with `AGENT_MODE=external` (or `RUNNER=external`) on
`run-incident.mjs`; the default remains the scripted runner.

## Bring it up and exec in

The easy path (prepares the clone and brings up the sandbox with the right
`DEPLOY_NETWORK` / `API_URL`):

```sh
pnpm forge agent booklogr
```

The manual path is below. The neutral `agent.yml` requires the deploy-plane
coordinates at compose parse-time (for **every** `docker compose … agent.yml`
command, including `exec`/`down`), so export booklogr's once first:

```sh
export DEPLOY_NETWORK=booklogr_default API_URL=http://booklogr-api:5000
```

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

Egress is sealed at boot (empty allowlist ⇒ zero external reach). For a
**cloud-model** agent, re-apply the firewall with the provider allowed — via a
**root** exec so the allowlist is passed per-exec and never lands in the agent's
container env:

```sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -u 0 -e EGRESS_ALLOWLIST=api.anthropic.com agent-shell /usr/local/sbin/init-firewall.sh
```

Exec into the agent's world as the **non-root** agent (the `-u` is required — see
the boundary note above):

```sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -u "$(id -u):$(id -g)" agent-shell sh
```

## Verify the boundary

From inside the sandbox, `scripts/verify-boundary.sh` asserts the agent-side
invariants (endpoints reachable; the harness does not resolve; no docker; the
workspace carries no forge/baseline tells):

```sh
docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-boundary.sh agent-shell:/tmp/vb.sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -u "$(id -u):$(id -g)" agent-shell sh /tmp/vb.sh
```

Its positive counterpart, `scripts/verify-alert-pickup.sh`, asserts the agent can
do the on-call job the brief hands it: pick the firing alert up off Alertmanager
and query Prometheus for the signals behind it, with no rig tell in what it sees.
Pass `REQUIRE_FIRING=1` during an armed run to require the scenario's target alert:

```sh
docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-alert-pickup.sh agent-shell:/tmp/vap.sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -u "$(id -u):$(id -g)" -e REQUIRE_FIRING=1 agent-shell sh /tmp/vap.sh
```

`scripts/verify-egress.sh` asserts the egress boundary: intra-plane services still
answer, but external hosts (github, registries) are blocked. Pass `EXPECT_ALLOWED`
to also confirm a cloud run's provider connects:

```sh
docker cp use-cases/booklogr/stacks/flask-compose/scripts/verify-egress.sh agent-shell:/tmp/ve.sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
  exec -u "$(id -u):$(id -g)" agent-shell sh /tmp/ve.sh
```

Host-side, `scripts/verify-detell.sh` audits the deploy-plane containers (env /
labels / mounts / logs / image-clock) for leakage.

(All four in-box probes run concurrently via `pnpm forge verify booklogr`.)

## Operator notes

- **Read the cheat-signal.** Blocked egress attempts increment the `EGRESS_BLOCKED`
  chain counter (agent-invisible — read it as **root**):

  ```sh
  docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml \
    exec -u 0 agent-shell iptables -nvL EGRESS_BLOCKED
  ```

- **If the container restart-loops on first bring-up**, the `ipset` kernel modules
  may have failed to autoload in the engine VM. Preload them once per VM boot, then
  re-run `pnpm forge agent booklogr`:

  ```sh
  rdctl shell -- sudo modprobe xt_set ip_set ip_set_hash_net   # Rancher Desktop
  ```

Tear down (the deploy plane is unaffected):

```sh
docker compose -p sreforge-agent -f infra/agent-sandbox/agent.yml down
```

## Design notes

The boundary's threat model, the isolation-mechanism trade-offs, and the tracked
residuals live in the project's design notes, not here.
