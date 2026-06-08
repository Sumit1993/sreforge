# SREForge

A contamination-controlled, event-triggered **evaluation harness for autonomous
SWE/SRE agents**. SREForge authors incidents on controlled substrates, hands an
agent a neutral on-call page, and grades the agent on whether its **deployed
fix actually resolves the incident** — verified behaviourally, under the
still-active fault. You cannot bluff a behavioural oracle.

## Why it's different

- **Closed-loop behavioural verification (the signature capability).** The fault
  stimulus keeps running while the fix is verified. An alert clears only because
  the deployed change works — not because the harness stopped poking the system.
  This is the anti-cheat: diff-matching is at most a hint, never the grade.
- **Contamination-free by construction.** v1 substrates are self-built, so there
  is no public solution to memorise. Adopted third-party apps get a de-tell pass
  before use.
- **Authored, reproducible incidents.** A determinism gate confirms the incident
  has actually reproduced before the agent is ever handed the page.
- **Honest, neutral framing.** The agent is never told it's in a harness.

## Taxonomy

Four axes:

| Axis | What | Example |
|------|------|---------|
| **engine** | the domain-agnostic harness | `core/` |
| **use-case** | a problem domain | `todo-app` |
| **stack** | a concrete deployable substrate | `node-compose` |
| **scenario** | one authored incident on a stack | `latency-retry-storm` |

Two scenario **profiles**: `incident` (live deploy + behavioural verify — the
focus of v1) and `patch` (DeepSWE-style pinned repo + hidden tests, deferred).

## Layout

```
core/                                  # @sreforge/core — the engine (TypeScript)
  src/{triggers,context,runner,deploy,verify,record,cleanup}/
use-cases/
  todo-app/
    stacks/node-compose/               # the substrate: NestJS API + Postgres +
      apps/{api,ui}  packages/{core,db,…}   #  Valkey + Prometheus + Alertmanager + Grafana
      compose/docker-compose.yml       # the self-contained local closed loop
      observability/                   # prometheus.yml, alertmanager.yml, rules/
      load/driver.mjs                  # zero-dep baseline / storm load driver
      scripts/                         # up · down · confirm-fire · verify-clear · incident
    scenarios/latency-retry-storm/     # the authored incident (scenario.toml, trigger, solution, oracle)
mage/                                  # pointer to the external knowledge-base hub
```

The durable design knowledge lives in an external **mage** hub
(`sreforge-memory`); this repo's `AGENTS.md` explains how to navigate it.

## v1 — the `latency-retry-storm` incident (validated end-to-end)

A planted retry-of-non-transient-error bug in the Todo API turns malformed
`DELETE /api/todos/<non-integer>` requests into a ~270ms retry storm. Under
sustained malformed load, p99 latency crosses 0.3s and the
`TodoApiLatencyP99High` alert fires. The reference fix (`ParseIntPipe` on the id
param + a retry filter for non-transient errors) makes those requests a fast
4xx — so the alert clears **while the load is still running**.

### Run it

Requires Docker (compose) + Node 18+ + pnpm. From the stack directory:

```sh
cd use-cases/todo-app/stacks/node-compose
bash scripts/incident.sh      # full loop: up → fire → fix → CI → redeploy → verify → reset
```

Or drive the pieces yourself:

```sh
bash scripts/up.sh                          # build + start the stack
node load/driver.mjs --mode=storm           # inject the fault (leave running)
node scripts/confirm-fire.mjs               # determinism gate: wait for the alert
node scripts/status.mjs                     # live p99 + firing alerts
node scripts/verify-clear.mjs               # after a fix+redeploy: clears under load?
bash scripts/down.sh                        # tear down
```

Endpoints once up: API `http://localhost:3000/api` · Prometheus `:9090` ·
Alertmanager `:9093` · Grafana `:3002`.

## Status

v1 substrate + scenario are built and the incident loop is validated
(trigger → confirm-fire → fix → CI gate → redeploy → behavioural verify →
reset). The `core/` engine is a typed skeleton; wiring the scenario runner
through it is the next milestone. See `mage/` (the knowledge-base hub) for the
full plan and decisions.
