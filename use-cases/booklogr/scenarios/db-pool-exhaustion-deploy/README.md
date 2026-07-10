# db-pool-exhaustion-deploy

An `incident`-profile scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** A deploy-time configuration change reduces the database connection pool size and switches gunicorn to threaded workers, exhausting DB connections under moderate uncached read load and starving workers until p99 latency breaches the 300 ms SLO and fires `BooklogrApiLatencyP99High`. The fix must restore DB connection pool headroom.

The agent is paged with the firing alert — the engine's `ContextAssembler`
renders the neutral incident brief from the alert plus the live endpoints — then
investigates the live stack and submits a fix via `submit`. The harness
builds + redeploys it, then
the [mitigation oracle](verify/oracle.md) scores whether the alert clears and
stays cleared **under still-active load**.

## Layout

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `scenario.toml`               | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/fault.patch`          | the actual patch to apply at arm time to inject the issue          |
| `solution/fix.patch`          | canonical reference fix (reverting the connection-limiting patch)  |
| `verify/oracle.md`            | v1 mitigation-oracle spec (CompoundedOracle contract)              |

The stack itself lives at `../../stacks/flask-compose/`.

## Run it end to end

Before running this scenario for the first time, you must create its local anchor base:

```bash
bash scripts/prepare-scenario.sh db-pool-exhaustion-deploy
```

The full automated loop — arm the incident (regress + storm + confirm-fire),
drive a scripted reference fix through the engine (CI gate → auto-merge →
redeploy → behavioral oracle under still-active load), then reset — is one
command from the stack dir:

```bash
SCENARIO_ID=db-pool-exhaustion-deploy pnpm forge arm booklogr
SCENARIO_ID=db-pool-exhaustion-deploy pnpm forge run booklogr
```

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
