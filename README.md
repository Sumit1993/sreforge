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
| **use-case** | a problem domain | `booklogr` |
| **stack** | a concrete deployable substrate | `flask-compose` |
| **scenario** | one authored incident on a stack | `latency-cache-stampede` |

Two scenario **profiles**: `incident` (live deploy + behavioural verify — the
focus of v1) and `patch` (DeepSWE-style pinned repo + hidden tests, deferred).

## Layout

```
core/                                  # @sreforge/core — the engine (TypeScript)
  src/{triggers,context,runner,deploy,verify,record,cleanup}/  conductor.ts
infra/forge/                           # shared Gitea + Actions runner (project sreforge-forge)
use-cases/
  booklogr/
    stacks/flask-compose/              # the substrate overlay: Flask API (gunicorn -w4)
      compose/docker-compose.yml       #   + Postgres + slow-upstream stub + Prometheus/
      compose/load.yml                 #   Alertmanager/Grafana; load.yml = isolated load plane
      observability/                   # prometheus.yml, alertmanager.yml, rules/
      load/booklogr-storm.js           # k6 constant-arrival-rate storm
      scripts/                         # up · down · arm-incident · confirm-fire · run-incident
    scenarios/latency-cache-stampede/  # the authored incident (scenario.toml, solution, oracle)
mage/                                  # pointer to the external knowledge-base hub
```

The durable design knowledge lives in an external **mage** hub
(`sreforge-memory`); this repo's `AGENTS.md` explains how to navigate it.

## v1 — the `latency-cache-stampede` incident (validated end-to-end)

A disabled search-response cache (`CACHE_TYPE=NullCache`) in the booklogr API
means every `GET /v1/books/search` misses cache and blocks a Gunicorn worker on
a deterministically slow (1.2s) book-metadata upstream. Under a k6 constant-
arrival-rate storm over a small query set, the four workers back up, p99 latency
crosses 0.3s, and the `BooklogrApiLatencyP99High` alert fires. The reference fix
(restore an effective cache) lets repeated queries hit the cache — so p99 clears
**while the storm is still running**.

### Run it

Requires Docker (compose) + Node 18+. From the stack directory:

```sh
cd use-cases/booklogr/stacks/flask-compose
bash scripts/smoke-positive.sh   # reference fix through the full conductor loop: must PASS
bash scripts/smoke-negative.sh   # a plausible-but-wrong fix: must NOT pass (D4 anti-cheat)
```

Or drive the pieces yourself:

```sh
bash scripts/up.sh                          # build + start the deploy plane (forge is separate, persists)
bash scripts/arm-incident.sh                # inject regression + start the storm + confirm-fire
node scripts/run-incident.mjs               # one conductor loop (trigger→…→verify→record→cleanup)
node scripts/status.mjs                     # live p99 + firing alerts
bash scripts/down.sh                        # tear down the deploy plane
```

Endpoints once up: API `http://localhost:5000` · web `:5150` · Prometheus `:9090` ·
Alertmanager `:9093` · Grafana `:3002` · Gitea forge `:3000`.

## Status

v1 is validated end-to-end on the `booklogr` use case: the `core/` engine's
**Conductor** drives the full incident loop (trigger → context → run → CI gate →
merge → redeploy → behavioural verify → record → cleanup) against a live,
already-firing incident. The agent seam (`AgentRunner`) is currently exercised by
a scripted reference fix; wiring a real autonomous agent through it is the next
milestone. See `mage/` (the knowledge-base hub) for the full plan and decisions.
