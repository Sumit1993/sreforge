# latency-retry-storm

An `incident`-profile SREForge scenario on the `todo-app` / `node-compose` stack.

**Incident (one line):** sustained malformed `DELETE /api/todos/<non-int>` traffic
triggers a retry storm that drives p99 latency to ~0.49s and fires
`TodoApiLatencyP99High`; the fix must fast-fail malformed input so latency clears
while load is still active.

The agent is paged with [`trigger.md`](trigger.md), investigates the live stack,
and submits a fix via `sreforge submit`. The harness builds + tests + redeploys
it, then the [mitigation oracle](verify/oracle.md) scores whether the alert
clears and stays cleared **under still-active load**.

## Layout

| File                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `scenario.toml`               | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `trigger.md`                  | the neutral on-call page handed to the agent             |
| `solution/reference-fix.md`   | canonical reference fix + behavioral acceptance criteria |
| `verify/oracle.md`            | v1 mitigation-oracle spec (CompoundedOracle contract)    |

The stack itself lives at `../../stacks/node-compose/`.

## Run it manually (end to end)

The full incident lifecycle — bring up the stack, confirm the alert fires under
storm load, hand off, then verify a fix clears it — is driven from the stack dir:

```bash
# from use-cases/todo-app/stacks/node-compose/
./scripts/incident.sh latency-retry-storm
```

Individual pieces, if you want to step through them:

```bash
# 1. start the malformed-DELETE storm (runs continuously)
node load/driver.mjs --mode=storm

# 2. wait for TodoApiLatencyP99High to enter the firing state (confirm-fire gate)
node scripts/confirm-fire.mjs --alert TodoApiLatencyP99High

# 3. apply a fix (see solution/reference-fix.md), rebuild + redeploy the api:
docker compose -f compose/docker-compose.yml build api
docker compose -f compose/docker-compose.yml up -d api

# 4. confirm the alert clears and stays cleared while the storm is STILL running
```

> These scripts (`scripts/incident.sh`, `scripts/confirm-fire.mjs`,
> `load/driver.mjs`) live in the stack directory and are created separately from
> this scenario folder.

## Inspect the running stack

| Resource     | URL                              |
| ------------ | -------------------------------- |
| Todo API     | http://localhost:3000/api        |
| API metrics  | http://localhost:3000/api/metrics |
| Prometheus   | http://localhost:9090            |
| Alertmanager | http://localhost:9093            |
| Grafana      | http://localhost:3002            |
