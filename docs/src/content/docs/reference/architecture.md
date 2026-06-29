---
title: Architecture
description: The domain-agnostic engine, its modules, the two-tree separation, and the run lifecycle.
sidebar:
  order: 2
---

`core/` (`@sreforge/core`) is the **domain-agnostic engine**. It orchestrates one
incident run end-to-end and contains **no** use-case, stack, or scenario logic; it
never references a concrete substrate. Domains plug in through the interfaces the
package exports.

## Two physically separate trees

The agent only ever clones the **substrate**; it never sees the harness.

```
# HARNESS — the agent NEVER sees this  (repo: sreforge)
sreforge/
  core/                    domain-agnostic engine (TypeScript)
    triggers/ context/ runner/ deploy/ verify/ record/ cleanup/  conductor.ts
  use-cases/
    booklogr/
      stacks/flask-compose/   the deployable substrate + observability overlay
      scenarios/latency-cache-stampede/   scenario.toml + inject/ + verify/ + solution/
  tools/
    detell-judge/          3-axis substrate intake gate
    contamination-guard/   scan for harness-leak + marker comments
  infra/forge/             shared Gitea + Actions runner

# AGENT-VISIBLE SUBSTRATE — a real app imported into the local forge (real history kept)
booklogr/                  Flask API + React UI + Postgres
```

The **run workspace** is a per-run copy of the substrate; its only `origin` is the
local forge — so the separation is also a network boundary (the cheap half of
[retrieval isolation](../../concepts/contamination-control/)).

## Engine modules

| Module | Responsibility |
|---|---|
| `triggers/` | Event sources → a normalized `Trigger`. v1: `PrometheusAlertTrigger` reads `/api/v1/alerts`. |
| `context/` | `ContextAssembler`: `Trigger` + `AgentContext` → a neutral, honest programmatic brief. |
| `runner/` | `AgentRunner` boundary where an external meta-harness plugs in; collects a `Trajectory`. |
| `deploy/` | `CiGate` (build + tests) → `AutoMerge` (commit to the run workspace) → `CdDeployer` (compose rebuild + swap). |
| `verify/` | `Oracle` / `CompoundedOracle` / `MitigationOracle` — the behavioural, objective oracle. |
| `record/` | `RunRecorder`: persist a `RunRecord` (trigger + trajectory + diff + score + timings). |
| `cleanup/` | `Cleanup`: reset the workspace, tear down the deployment, redeploy the baseline, stop load. |
| `conductor` | `Conductor` / `runIncident(config, deps)`: sequences all of the above. |

Scenarios are **code** for the `incident` profile (a `Problem`-like class with
`injectFault()` / `recoverFault()` plus attached oracles) and **declarative** for
the `patch` profile (folder + hidden tests + reference solution).

## The incident run lifecycle

```
poll trigger → assemble context → run agent → CI gate → auto-merge
   → CD redeploy → behavioural verify → record → cleanup
```

1. **trigger** — the scenario has already injected the fault and confirmed the
   target alert is firing (the confirm-fire gate is the scenario's
   responsibility). The conductor polls the trigger source for the `Trigger`.
2. **context** — assemble a neutral brief from the trigger and `AgentContext`
   (service endpoints + run-workspace path/service + submit command). No mention
   of a harness or evaluation.
3. **run** — hand the brief to the `AgentRunner`. The agent investigates, edits
   the run workspace in place, and calls `submit`. It never merges or deploys.
4. **CI gate** — build + the substrate's existing tests. Red → no deploy, the
   alert persists, the run is rejected (CI output becomes feedback).
5. **auto-merge → CD redeploy** — on green, commit the fix and rebuild + swap the
   affected service's container.
6. **verify** — with the fault stimulus still active, the mitigation oracle scores
   multi-signal (CI green + alert cleared + sustained clear + time-to-clear + no
   new alerts).
7. **record** — persist trigger + trajectory + diff + score + verdict + timings.
8. **cleanup** — always runs; restores the baseline (regressed) image for the next
   run.

The deploy chain runs on a **local Git forge** (Gitea + Actions): the engine's
`GiteaCiGate` polls the real Actions run and `GiteaAutoMerge` merges the real PR.
The **CD redeploy stays engine-side** (`ComposeCdDeployer`) — it is the topology
adapter (compose → k8s → VM behind one `redeploy()`) *and* must be coordinated
with the oracle's grading window: drain → deploy cold → warm → **resume load
before returning**, so verify runs under still-active fault.

## v1 scope

- **Profile:** `incident` only.
- **Trigger:** a single firing Prometheus alert.
- **Oracle:** `MitigationOracle` only — fully objective, no LLM. Submission is
  fix-only.
- **Fix delivery:** a local per-run run workspace; no github.com. Deploy is
  CI gate → auto-merge → CD-on-merge redeploy.
- **Tool surface:** shell + documented endpoints + `submit`.

The contracts (engine layout, closed-loop verify, run record, oracle taxonomy)
are baked in now; the v1 implementation drives exactly one use-case scenario.

:::note[Implementation status]
This is the v1 **scaffold**: all types and interfaces are complete and
self-consistent, and the conductor sequences every phase. The full incident loop
is validated end-to-end on `booklogr`. Wiring a real autonomous agent through the
`AgentRunner` seam is the next milestone.
:::

## See also

- [Closed-loop verification](../../concepts/closed-loop-verification/)
- [Run contract](../run-contract/)
- [Design decisions](../decisions/)
