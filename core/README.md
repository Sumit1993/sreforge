# @sreforge/core

The **domain-agnostic engine** of SREForge — a contamination-controlled,
event-triggered evaluation harness for autonomous SWE/SRE agents.

`core/` orchestrates one incident run end-to-end and contains **no**
use-case, stack, or scenario logic. It never references a concrete substrate;
domains plug in through the interfaces this package exports.

## Role

SREForge evaluates an agent's ability to *actually mitigate a live incident on a
real deployment* — not to pattern-match a fix. The engine drives the closed
loop and the behavioral oracle that makes the evaluation cheat-resistant: the
harness never stops the fault to clear the alert; **only a correctly deployed
fix can**.

## Module map

| Module       | Responsibility                                                                              |
| ------------ | ------------------------------------------------------------------------------------------- |
| `triggers/`  | Event sources → a normalized `Trigger`. v1: `PrometheusAlertTrigger` reads `/api/v1/alerts`. |
| `context/`   | `ContextAssembler`: `Trigger` + `AgentContext` → a neutral, honest programmatic brief.       |
| `runner/`    | `AgentRunner` boundary where an external meta-harness (t3code) plugs in; collects a `Trajectory`. |
| `deploy/`    | `CiGate` (build + tests) → `AutoMerge` (commit to run workspace) → `CdDeployer` (compose rebuild + swap). |
| `verify/`    | `Oracle` / `CompoundedOracle` / `MitigationOracle` — the behavioral, objective oracle.       |
| `record/`    | `RunRecorder`: persist a `RunRecord` (trigger + trajectory + diff + score + timings) to a run directory. |
| `cleanup/`   | `Cleanup`: reset the workspace, tear down the deployment, redeploy the baseline, stop load.   |
| `conductor`  | `Conductor` / `runIncident(config, deps)`: sequences all of the above.                        |

## Run lifecycle (the closed loop)

```
poll trigger → assemble context → run agent → CI gate → auto-merge
   → CD redeploy → behavioral verify → record → cleanup
```

1. **trigger** — the scenario has already injected the fault and confirmed the
   target alert is firing (the confirm-fire gate is the *scenario's*
   responsibility). The conductor polls the trigger source to obtain the
   normalized `Trigger`.
2. **context** — assemble a neutral, honest brief from the trigger and the
   `AgentContext` (service endpoints + run-workspace path/service + submit
   command). No mention of a harness or an evaluation.
3. **run** — hand the brief to the `AgentRunner`. The agent investigates,
   edits the run workspace in place, and calls `submit`. It never merges or
   deploys.
4. **CI gate** — build + the substrate's existing tests against the run
   workspace. Red → no deploy, the alert persists, the run is **rejected**
   (CI output becomes agent feedback).
5. **auto-merge → CD redeploy** — on green, commit the fix to the run
   workspace and rebuild + swap the affected service's container.
6. **verify** — with the fault stimulus still active, the mitigation oracle
   scores multi-signal: CI green + the target alert clears + it stays cleared
   for `sustainedClearSeconds` + time-to-clear + no new alerts.
7. **record** — persist trigger + trajectory + diff + score + verdict + timings.
8. **cleanup** — always runs; restores the baseline (buggy) image for the next
   run.

## v1 scope

- **Profile:** `incident` only.
- **Trigger:** a single firing Prometheus alert.
- **Oracle:** `MitigationOracle` only — fully objective, **no LLM**. Submission
  is fix-only.
- **Fix delivery:** a local per-run **run workspace**; **no github.com**. Deploy
  is CI gate → auto-merge (commit) → CD-on-merge redeploy.
- **Tool surface:** shell + documented endpoints + `submit` — universal primitives, no separate tool layer.

The contracts (engine layout, closed-loop verify, run record, oracle taxonomy)
are baked in now; the v1 implementation drives exactly one use-case scenario.

## Deferred (contracts present, implementation later)

- **`DiagnosisOracle`** (LLM-judge against a structured root-cause + checklist,
  separate judge model) — drops into `CompoundedOracle` as one more weighted
  sub-oracle with no refactor; the submit payload then gains an `rca` field.
- **`patch` profile** (declarative folder + hidden tests + reference solution).
- **GitHub fork/PR/branch-protection** apparatus.
- **Multi-signal / Slack triggers** (the v2 trigger-bus generalization).
- **Synthetic-history / personas** (cover identity).

## Status

This is the v1 **scaffold**: all types and interfaces are complete and
self-consistent, and the conductor sequences every phase. Concrete deploy/CI/CD
and cleanup bodies throw `Error("not implemented in v1 scaffold")` until wired
to a stack; `NoopAgentRunner` stands in until the t3code seam is filled.
