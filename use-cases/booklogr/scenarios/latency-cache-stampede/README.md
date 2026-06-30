# latency-cache-stampede

An `incident`-profile SREForge scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** a cache stampede on book search under storm load drives
p99 latency above the 300 ms SLO and fires `BooklogrApiLatencyP99High`; the fix
must restore effective caching so repeated search queries no longer flood the slow
upstream while load is still active.

The agent is paged with the firing alert — the engine's `ContextAssembler`
renders the neutral incident brief from the alert plus the live endpoints — then
investigates the live stack and submits a fix via `sreforge submit`. The harness
builds + redeploys it, then
the [mitigation oracle](verify/oracle.md) scores whether the alert clears and
stays cleared **under still-active load**.

## Layout

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `scenario.toml`               | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `solution/fix.patch`          | canonical reference fix (the cache-backend restore patch)          |
| `verify/oracle.md`            | v1 mitigation-oracle spec (CompoundedOracle contract)              |

The stack itself lives at `../../stacks/flask-compose/`.

## Run it end to end

The full automated loop — arm the incident (regress + storm + confirm-fire),
drive a scripted reference fix through the engine (CI gate → auto-merge →
redeploy → behavioral oracle under still-active load), then reset — is one
command from the stack dir:

```bash
# from use-cases/booklogr/stacks/flask-compose/
bash scripts/smoke-positive.sh        # reference fix: must PASS
bash scripts/smoke-negative.sh        # a plausible-but-wrong fix: must NOT pass (ADR-0004 anti-cheat)
```

`scripts/run-incident.mjs` is the conductor driver those wrap: it assumes the
incident is already armed (alert firing) and runs exactly one engine loop
(trigger → scripted fix → CI → merge → redeploy → oracle → record → cleanup).

Individual pieces, if you want to step through the observability path by hand:

```bash
# 1. inject the regression onto the baseline branch (harness-side, run once)
./scripts/inject-regression.sh

# 2. bring up the full stack (API, web, observability, stub upstream)
./up.sh

# 3. start the k6 constant-arrival-rate storm (runs continuously)
docker compose -p booklogr-edge -f compose/load.yml up -d

# 4. wait for BooklogrApiLatencyP99High to enter the firing state
node scripts/confirm-fire.mjs --alert BooklogrApiLatencyP99High

# 5. apply a fix (see solution/fix.patch), rebuild + redeploy the api:
docker compose -f compose/docker-compose.yml build booklogr-api
docker compose -f compose/docker-compose.yml up -d booklogr-api

# 6. confirm the alert clears and stays cleared while the storm is STILL running
node scripts/verify-clear.mjs --alert BooklogrApiLatencyP99High
```

> These scripts live in the stack directory (`../../stacks/flask-compose/scripts/`)
> and are shared across all booklogr scenarios.

## Inspect the running stack

| Resource     | URL                       |
| ------------ | ------------------------- |
| booklogr API | http://localhost:5000     |
| booklogr web | http://localhost:5150     |
| Prometheus   | http://localhost:9090     |
| Alertmanager | http://localhost:9093     |
| Grafana      | http://localhost:3002     |

> API metrics are exported on a dedicated port (`booklogr-api:9090`) by the
> prometheus-flask-exporter in multiprocess mode — they are not on `:5000/metrics`.
