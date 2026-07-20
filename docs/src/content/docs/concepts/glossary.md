---
title: Glossary
description: Canonical terms for SREForge.
sidebar:
  order: 5
---

Canonical terms. When a word is overloaded, the definition here wins.

:::note[Key disambiguation]
**Import** = the one-time intake of an upstream app into our forge.
**Run workspace** = the per-run copy the agent edits.
**Fork** = the github.com action we deliberately avoid.
:::

### SREForge
The evaluation *engine / harness*. Not an ops tool, and not named after any
use-case or cover identity.

### Use-case
An imported real app plus its problem domain, hosted inside SREForge (e.g.
`booklogr`). It keeps its **real identity**; cover identities and personas are
retired.

### Substrate
The *source* application a scenario runs on: a real, lesser-known public app
imported into the forge with its real git history kept. The realistic backdrop —
never the task itself.

### Import (the substrate)
The one-time act of bringing a real upstream app into the **local Git forge with
full history kept** — `git clone --mirror` + push, or Gitea's API migration. **Not
a github.com fork.** The result is the *substrate repo*.

### Run workspace
The per-run isolated **copy** of the substrate repo, checked out from the local
forge (so its `origin` is the forge). It is deployed, faulted, edited by the
agent, and redeployed.

### Deployment
The running services built from a run workspace — where alerts fire and the agent
investigates.

### Scenario
An **authored** incident or task. Carries a `profile`.

### Profile
`patch` (static repo + hidden tests, DeepSWE-style) or `incident` (live
deployment + behavioural verify, SREGym-style). See
[Taxonomy & profiles](../taxonomy/).

### Trigger
The short signal that starts a run (e.g. a firing Prometheus alert). The agent
gets only this plus assembled context — not the diagnosis.

### Oracle
A verifier. Returns a structured verdict from `(solution, trajectory, duration)`.

### Compound oracle
A weighted composition of oracles across the SRE lifecycle (**detect → diagnose →
mitigate**). v1 ships the contract but implements only the *mitigation*
dimension.

### Closed loop
Fix → deploy → re-verify *under still-active fault*. The alert clears only because
the deployed fix works. SREForge's defining property and its anti-cheat.

### CI gate → auto-merge → CD-on-merge
How a fix deploys in v1, via the local Gitea forge + Actions: the agent
`submit`s → CI runs build + tests → on green it auto-merges → CD-on-merge
redeploys. The agent never deploys.

### Organic regression
The v1 fault shape: a fault **edited into the substrate's existing code** (e.g.
weakening a timeout on an external-API path), *never a bolt-on module*.

### Retrieval isolation
The run workspace's git remote is the local forge, not the public upstream, so it
can't be diffed to read off the fault. Active web-fetch blocking is a conditional
add-on per the substrate's memorization score.

### 3-axis intake gate
Substrate vetting (`tools/detell-judge`), all lower-is-better: **rig-confidence**
(gated), **recognizability** (v1 report-only), **memorization** (v1 report-only,
the decisive selection axis).

### Observability test
The rule for realism-on-demand: keep a realism feature only if the agent can
observe it *and* its absence would reveal the harness.

### Authored task
The invariant that the incident/feature is invented by the scenario author (with
private tests/oracle), never a pre-existing public bug. The source of
contamination-freeness.

### `submit`
The agent's "done, here's my fix" signal (optionally passing `--rca`). It is an **engine handoff, not a forge
push**: the agent commits to a local branch and drops a completion sentinel; the
engine captures the diff and owns the forge push / PR / CI. The sandbox has no
forge access.

### Run record
The canonical artifact emitted per run (the on-disk record is snake_case `run-record.v1`; the in-memory TypeScript `RunRecord` type is camelCase), containing identity, the agent's trajectory, diff, CI/CD results, scores, and timings.

### Pruned record
A copy of the run record stripped of the raw agent transcript (to keep its size manageable) but retaining identity and scores, committed to the scenario's `records/` directory.
