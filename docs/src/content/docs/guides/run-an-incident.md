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
| **run** | Hand the brief to the agent. It investigates, edits the run workspace in place, and calls `submit` (a postmortem attachment is standard practice, but the `--rca` flag is optional). It never merges or deploys. |
| **CI gate** | Build + the substrate's existing tests against the run workspace. Red → no deploy, the alert persists, the run is rejected (CI output becomes feedback). |
| **auto-merge → CD redeploy** | On green, commit the fix to the run workspace and rebuild + swap the affected service's container. |
| **verify** | With the fault stimulus still active, the mitigation oracle scores multi-signal: CI green + the alert clears + stays cleared for the sustained window + time-to-clear + no new alerts. |
| **record** | Persists record + agent transcript + RCA; outputs land in `runs/<runId>/`, pruned copy under the scenario's `records/`. |
| **cleanup** | Always runs; restores the baseline (regressed) image for the next run. |

The confirm-fire gate (proving the alert actually fired *before* the agent
starts) is the **scenario's** responsibility, not the engine's. (Arming is explicitly split into two halves: `arm-regress` applies the fault, and `arm-fire` blocks until the alert fires). See
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

Run `pnpm forge doctor <use-case>` before a session and `pnpm forge forge-up` when the runner is down.

```sh
# Cold bring-up (once)
pnpm forge fresh booklogr

# Inspect the live stack: alerts, metrics, dashboards
#   Alertmanager  http://localhost:9093
#   Prometheus    http://localhost:9090
#   Grafana       http://localhost:3002
#   Dashboard     pnpm forge dashboard (global operator control plane)

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

Three checks make verification reliable:

- **Pre-arm quiesce gate** — before every arm, the harness stops active load, recreates Prometheus and Alertmanager containers to wipe carryover TSDB/alert state (#74), optionally lays a fixed warm-up baseline, and asserts 0 firing AND 0 pending alerts with healthy scrape targets. Alerts labelled `role: ambient` are exempt — see below.
- **Confirm-fire before handoff** — setup injects the fault *and* confirms the
  target alert entered the firing state before the run proceeds. If it never
  fires, the run aborts or retries; a non-incident is never handed to an agent.
- **Sustained-clear on verify** — the alert must stay cleared for the configured
  window while load is still active. A momentary dip does not count as a pass.

## Running scenarios back-to-back

Everything above is written for a single incident. A batch — a qualification
campaign, an A/B sweep — hits two things a one-shot run never does.

### Do not gate on a fully-inactive rule set

Some alert rules are **ambient furniture**: deliberate background noise so a
scenario is not the only thing an agent sees. They are not scenario signals and
they are never quiet. `EdgeClientRequestJitter` is the current example — it
reduces to `time() % 120 < 60`, so it fires for 60 seconds out of every 120
forever, whether or not anything is armed and whether or not the load plane is
running.

So a driver that waits for *"no alerting rule is non-inactive"* is not waiting
for a quiet stack, it is racing a clock: it can only pass during the 60-second
down-phase, and it has to fit its whole settle streak inside that window.
Tightening a gate to that condition has been measured making things **worse** —
one external driver's failure rate went from 33% to 57%.

Two supported ways to do it right:

- **Filter by label.** Every ambient rule carries `role: ambient`, so a driver can
  drop them programmatically rather than by hardcoded name. `rules-lint` enforces
  the label in both directions, so a new ambient rule cannot forget it and a real
  scenario signal cannot claim it.
- **Or just gate on your own alert** — wait for the scenario's `[expected] alert`
  from its `scenario.toml` to be inactive, and ignore every other rule. This is
  the narrowest correct gate.

`pnpm forge quiesce <use-case>` already does the right thing here — with one
caveat about *which* scenario it scopes to, below.

### The gate is scoped to the scenario you are arming

The built-in gate exempts two classes of alert from its firing/pending assertion,
and reports both, so an exemption is visible in the log rather than silent:

- **`role: ambient`** — the furniture above.
- **Alerts on a service the scenario does not grade.** This is the same
  `[verify] services` scope the compound oracle already uses for `no_new_alerts`,
  so the gate and the grade agree on what is in scope. An alert the scenario does
  not grade cannot block its arm.

That second rule is what stops a shared rules surface from deadlocking an
unrelated scenario. Six of the seven booklogr scenarios declare `booklogr-api`
only; a `book-metadata` alert pending during one of them is a diagnosis signal,
not a reason to refuse to arm. The one scenario that *does* declare
`book-metadata` still waits for it, because there the signal is genuinely
coupled.

#### Name the scenario when you quiesce standalone

The scope comes from `SCENARIO_ID`, and **the default is not "unscoped" — it is one
specific scenario.** `arm` and `auto` set it from the run, so the normal path is
correct without thinking about it. A bare standalone `quiesce` does not:

```sh
pnpm forge quiesce booklogr                                    # scopes to latency-cache-stampede
pnpm forge quiesce booklogr SCENARIO_ID=worker-cpu-starvation  # scopes to that scenario
```

This matters in one direction only, and it is the unsafe one: quiescing bare before
arming `worker-cpu-starvation` scopes to `[booklogr-api]` when that scenario grades
`[booklogr-api, book-metadata]`, so a `book-metadata` alert is exempted when it
should have blocked. The reverse is harmless.

The gate always prints the scope it resolved, so check the line rather than assume:

```
[confirm-quiesced] scoped to scenario 'worker-cpu-starvation' services=[booklogr-api,book-metadata] …
```

Invoking `scripts/confirm-quiesced.mjs` or `scripts/quiesce.sh` directly with no
`SCENARIO_ID` in the environment is the only path that is genuinely unscoped, and
it warns loudly that it is.

With no `SCENARIO_ID`, or a scenario declaring no `services`, the gate stays
strictly global and says so — the fallback is fail-closed.

**Scrape-target health stays global on purpose.** Only the *alert* assertion is
scoped. A down target blocks the arm no matter which scenario you are running,
because that is the check that catches a genuinely degraded dependency dragging
an in-scope service down without firing an in-scope alert. Alerts can be scoped
safely precisely because target health is not.

### Give the gate room after a hot run

Immediately after a run that drove real traffic, an alert computed over a rate
window can still be firing from data that is already historical. That is not a
stuck system and it settles on its own. The gate's deadline is 120s by default
and every flag has an env form, which is what to use since `arm` does not forward
flags:

```sh
QUIESCE_DEADLINE_S=300 pnpm forge arm booklogr
```

Erring long costs a wait; erring short throws away the arm.

## Next

- [Drive an external agent](../drive-an-agent/) — swap the scripted fix for a real
  agent.
- [Run contract](../../reference/run-contract/) — the data the engine consumes per
  run.
- [Architecture](../../reference/architecture/) — the engine modules behind each
  phase.
