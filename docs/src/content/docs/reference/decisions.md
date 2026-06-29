---
title: Design decisions
description: The architecture decisions behind SREForge — each with its terse rationale.
sidebar:
  order: 5
---

SREForge's design is captured as a set of numbered decisions (ADR-lite). The
D-numbers are stable and referenced throughout the engine, scenarios, and docs.
This page is a condensed, public summary of the rationale behind the system.

## D1 — Domain-agnostic engine + four-axis taxonomy
The engine is domain-agnostic with a four-axis taxonomy (engine · use-case · stack
· scenario). New coverage = new use-cases/stacks/scenarios, never engine rewrites.
*Why:* a single test app can't reach DeepSWE-style breadth. See
[Taxonomy](../../concepts/taxonomy/).

## D2 — Engine + authoring language = TypeScript
TypeScript, to match existing tooling; substrate code stays polyglot. *Why:*
Python's only edge (agent libs) is moot — the meta-harness is ours and the judge
is one API call.

## D3 — Two scenario profiles: `patch` and `incident`
`patch` = declarative folder (pinned repo + hidden tests + reference solution,
test-graded); `incident` = programmatic `Problem`/`Oracle` + live deployment +
behavioural verify. *Why:* cheap `patch` scenarios drive diversity while
`incident` is the signature capability.

## D4 — Behavioural closed-loop verification is the anti-cheat
The alert must clear *because the deployed fix works under still-active fault* —
never by stopping the injector. Diff-matching is at most a non-blocking hint.
*Why:* you can't bluff a behavioural oracle, so cheating/sandbagging simply fails.
See [Closed-loop verification](../../concepts/closed-loop-verification/).

## D5 — Fix delivery: per-run workspace + `submit`; deploy via the local forge
The agent edits a per-run workspace and calls `submit` — it never merges or
deploys. The harness then runs the deploy chain on a **local Git forge** (Gitea
Actions): push → CI gate → auto-merge → CD-on-merge redeploy. *Why:* keeps the
agent's interface minimal while deploy *realism* comes from a real forge. Never
the public github.com.

## D6 — Compound oracle; v1 = mitigation-only
The oracle is a weighted compound (detect → diagnose → mitigate). v1 ships only
**mitigation**, scored multi-signal, fully objective (no LLM). *Why:* stays
objective while separating models; diagnosis drops in later as one more weighted
oracle, no refactor.

## D7 — The task is always authored
The incident is invented by the scenario author with a private oracle — never a
pre-existing public bug. *Why:* public substrate + authored fault + private oracle
= contamination-safe, and it avoids the "real repos with bugs" goose chase.

## D8 — Marker-strip + neutral honest framing
Every agent-visible repo is marker-stripped (no `BUG#`/`FIXME`/`XXX`/`HACK`
annotations or harness references; the fault stays unlabelled). Task framing is a
neutral, honest page — the agent is never told it's in a harness. *Why:* the
anti-cheat is behavioural verification, not deception; the old disguise discipline
is retired.

## D9 — Agent tool surface: shell + endpoints + `submit`
The agent gets a non-root shell in a per-run sandbox on the deployment network,
documented HTTP endpoints, and a `submit` command. *Why:* universal primitives are
the most harness-neutral interface, and the sandbox boundary handles isolation by
construction. `submit` is an engine handoff (commit + sentinel), **not** a forge
push — the sandbox has no forge access.

## D10 — Determinism for reliable verification
(a) Gate the run on confirmed fire; (b) require sustained-clear on verify; (c)
prefer deterministic config/state injection over pure load where possible. *Why:*
removes the "non-incident handed to agent" and "momentary dip = false pass"
failure modes.

## D11 — Realism is on-demand
Apply the *observability test*: add a realism feature only if the agent can
observe it *and* its absence would reveal the harness. *Why:* the substrate's
genuine history supplies most realism for free.

## D12 — Physical harness/substrate separation
Two physically separate trees: the agent only ever clones the substrate; the
harness is never placed inside it. *Why:* a single tree co-locating the app with
orchestration scripts or `// BUG #N` markers betrays that it's staged — this
caused a real contamination leak. See
[Contamination control](../../concepts/contamination-control/).

## D13 — Phased purpose: v1 = capability; recognizability is informational
v1 is a capability leaderboard. Contamination-safety rests on four cheap things —
authored faults, organic regressions, retrieval isolation, and the D4 oracle — not
disguise. Recognizability + memorization are informational selection signals in
v1, hard gates in v2. Eval-awareness/sandbagging is an optional future research
question, untied from any disguise build.

## D14 — DeepSWE-for-SRE on imported real apps; 3-axis intake gate
The loop: import a real, lesser-known public app (keep its real git history),
author an organic regression that edits existing code, deploy from the local
forge, and grade with the D4 oracle. Substrates pass a 3-axis intake gate
(`tools/detell-judge`): **rig-confidence** (gated), **recognizability** and
**memorization** (report-only in v1). *Why over hand-building:* hand-building
convincing depth is too expensive and structurally caps the rig score.
**Substrate #1 = `Mozzo1000/booklogr`** — low on all three axes, so the eval
measures capability, not recall.

## D15 — Realism via local emulators: k6 + Gitea Actions
Load = **k6** (`constant-arrival-rate` holds an exact RPS regardless of response
time — the never-stopped storm D4/D10 require). CI/CD = a **local Git forge**
(Gitea + Actions): real git remote + PR/merge + real CI + CD-on-merge, all local.
Full-history import is satisfied by `git clone --mirror` + push, or Gitea's API
migration. *Standing principle:* prefer battle-tested tools over hand-rolling.

## D16 — Forge identity model: shared neutral admin + per-use-case maintainer
The shared forge has one neutrally-named site-admin for infra setup only; it never
performs agent-visible git activity. Each use-case provisions its own maintainer
identity at import (login = upstream owner handle, name/email = the repo's real
last author), which performs all agent-visible branch push / PR / merge. *Why:* the
git activity on an agent's repo must look like *that app's* maintainer, not a
harness account.

## D17 — Use-case-neutral command surface: `pnpm forge <verb> <use-case>`
The rig lifecycle is driven through a neutral dispatcher: the **verb** is the
stable vocabulary and the **use-case is a parameter**. *Why:* baking the use-case
into the command namespace is itself a neutrality leak and doesn't scale — a second
use-case needs zero new wiring. See the [CLI reference](../cli/).

## Foundational

- **F1 — Threat model.** The agent is a coding agent with maintainer-bounded
  access: it reads its run workspace (origin = local forge) and hits service URLs,
  but cannot reach the private harness. Blocking active web-fetch of the public
  upstream is a conditional control applied per the substrate's memorization
  score.
- **F2 — Scenario authoring principles.** Scenarios use real tooling (real
  migrations, no side-channel SQL), leave real revert artifacts, and emit deploy
  receipts — so the deployment looks genuine to an investigating agent.
- **F3 — Fixture / run lifecycle.** Three layers: **stack** (compose up, once) ·
  **setup** (per-run: inject + confirm-fire) · **teardown** (per-run, on success).

## D-open — agent t=0 context (resolved)
The agent is external and Alertmanager-driven: exec'd into the per-run sandbox, it
discovers the incident by polling Alertmanager, queries the observability stack +
app, then edits its workspace and runs `submit`. The external investigate → fix →
grade loop runs end-to-end via `ExternalAgentRunner`. v1 stays a single Prometheus
alert; multi-signal / Slack triage is the v2 generalization.
