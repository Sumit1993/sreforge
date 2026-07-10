# decoy-deploy-control

An `incident`-profile scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** the deployed cache backend has drifted to `NullCache` at the runtime/infra layer, driving p99 search latency above the 300ms SLO and firing `BooklogrApiLatencyP99High` — while the only commit that landed on main recently is an unrelated (and harmless) HTTP-status-code fix. The fix must restore the cache backend; reverting the recent commit does nothing.

The agent is paged with the firing alert — the engine's `ContextAssembler`
renders the neutral incident brief from the alert plus the live endpoints — then
investigates the live stack and submits a fix via `submit`. The harness
builds + redeploys it, then
the [mitigation oracle](verify/oracle.md) scores whether the alert clears and
stays cleared **under still-active load**.

This scenario is a **deploy-correlation control**: it exists to check whether
a fix genuinely addresses the mechanism, or merely reverts whatever changed
most recently in git. See [verify/oracle.md](verify/oracle.md) for the
mandatory negative test.

## Layout

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `scenario.toml`               | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/fault.patch`          | the innocent recent-deploy patch applied at arm time (does NOT cause the incident) |
| `solution/fix.patch`          | canonical reference fix (pins the cache backend)                   |
| `solution/reference-fix.md`   | acceptable fix families + why the negative test matters            |
| `verify/oracle.md`            | v1 mitigation-oracle spec (CompoundedOracle contract) incl. the mandatory negative test |
| `verify/negative-fixture.patch` | the "wrong fix" (revert of the innocent commit) the negative test applies |

The stack itself lives at `../../stacks/flask-compose/`.

## Run it end to end

Before running this scenario for the first time, you must create its local
anchor base — this scenario has its OWN preparation script (not the generic
`prepare-scenario.sh`), because its anchor carries two extra backdated "old
code" commits:

```bash
bash scripts/prepare-decoy-base.sh
```

The full automated loop — arm the incident (deploy the innocent commit, apply
the runtime cache override, start the storm, confirm-fire), drive a scripted
reference fix through the engine (CI gate → auto-merge → redeploy → behavioral
oracle under still-active load), then reset — is one command from the stack
dir:

```bash
SCENARIO_ID=decoy-deploy-control pnpm forge arm booklogr
pnpm forge run booklogr SCENARIO_ID=decoy-deploy-control
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
