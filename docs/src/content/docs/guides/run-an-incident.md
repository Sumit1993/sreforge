---
title: Run an incident
description: The incident run lifecycle in practice — phases, composites, and what each step does.
sidebar:
  order: 2
---

This guide explains what happens during an `incident`-profile run and how the
[CLI verbs](../../reference/cli/) map onto the phases of the closed loop. For a
copy-paste run, start with the [Quickstart](../quickstart/).

## The lifecycle

An `incident` run is a closed loop driven by the engine's **Conductor**:

```
poll trigger → assemble context → run agent → CI gate → auto-merge
   → CD redeploy → behavioural verify → record → cleanup
```

| Step | What happens |
|---|---|
| **trigger** | The scenario has already injected the fault and confirmed the target alert is firing. The conductor polls the trigger source for the normalized `Trigger`. |
| **context** | Assemble a neutral, honest brief from the trigger plus the `AgentContext` (service endpoints, run-workspace path/service, the submit command). No mention of a harness. |
| **run** | Hand the brief to the agent. It investigates, edits the run workspace in place, and calls `submit`. It never merges or deploys. |
| **CI gate** | Build + the substrate's existing tests against the run workspace. Red → no deploy, the alert persists, the run is rejected (CI output becomes feedback). |
| **auto-merge → CD redeploy** | On green, commit the fix to the run workspace and rebuild + swap the affected service's container. |
| **verify** | With the fault stimulus still active, the mitigation oracle scores multi-signal: CI green + the alert clears + stays cleared for the sustained window + time-to-clear + no new alerts. |
| **record** | Persist trigger + trajectory + diff + score + verdict + timings. |
| **cleanup** | Always runs; restores the baseline (regressed) image for the next run. |

The confirm-fire gate (proving the alert actually fired *before* the agent
starts) is the **scenario's** responsibility, not the engine's. See
[Closed-loop verification](../../concepts/closed-loop-verification/) for why both
the confirm-fire gate and the sustained-clear check matter.

## Verbs and composites

The lifecycle is driven through the neutral dispatcher `pnpm forge <verb>
<use-case>`. The **phase verbs** map one-to-one onto lifecycle stages; the
**composites** bundle them:

| Composite | Expands to | Use it for |
|---|---|---|
| `fresh` | `setup → up` | First-time cold bring-up |
| `agent-up` | `arm → agent` | Arm the incident + bring up the agent sandbox |
| `incident` | `arm → run → verify` | One graded run on an already-up stack |
| `e2e` | `setup → up → arm → run → verify → down` | Cold-start through teardown |

Trailing task args (for example `RUNNER=external`) flow only to the `run` phase
inside a composite. See the [CLI reference](../../reference/cli/) for the complete
verb list and argument handling.

## A typical session

```sh
# Cold bring-up (once)
pnpm forge fresh booklogr

# Inspect the live stack: alerts, metrics, dashboards
#   Alertmanager  http://localhost:9093
#   Prometheus    http://localhost:9090
#   Grafana       http://localhost:3002

# One graded run with the scripted reference fix
pnpm forge incident booklogr

# ...iterate...

# Tear down deploy + load planes (the forge persists)
pnpm forge down booklogr
```

To list the phases a given stack actually exposes:

```sh
pnpm forge menu booklogr
```

## Determinism guarantees

Two checks make verification reliable:

- **Confirm-fire before handoff** — setup injects the fault *and* confirms the
  target alert entered the firing state before the run proceeds. If it never
  fires, the run aborts or retries; a non-incident is never handed to an agent.
- **Sustained-clear on verify** — the alert must stay cleared for the configured
  window while load is still active. A momentary dip does not count as a pass.

## Next

- [Drive an external agent](../drive-an-agent/) — swap the scripted fix for a real
  agent.
- [Run contract](../../reference/run-contract/) — the data the engine consumes per
  run.
- [Architecture](../../reference/architecture/) — the engine modules behind each
  phase.
