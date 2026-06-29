---
title: Contamination control
description: The four cheap invariants that keep the SREForge signal trustworthy — without relying on disguise.
sidebar:
  order: 4
---

A benchmark for agents is only as good as its resistance to memorisation and
leakage. SREForge's contamination-safety rests on **four cheap invariants** —
not on disguising the substrate.

## The four invariants

### 1. Tasks are always authored

The incident is **invented by the scenario author**, with a private oracle —
never a pre-existing public bug. Public substrate + authored private fault +
private oracle = contamination-safe, by the same logic DeepSWE uses. This avoids
both the "real repos with known bugs" goose chase and the contamination it
brings.

### 2. Organic regressions, never bolt-ons

The fault is **edited into the substrate's existing code** — for example,
disabling an existing response cache on a hot path. It is never a bolt-on module.
Bolt-ons are the most-detectable, most-planted shape; an organic regression looks
like an ordinary mistake in the app's own history.

### 3. Retrieval isolation

The run workspace's git remote is the **local forge, not the public upstream**,
so the agent cannot diff the deployment against the original to read off the
fault. Active web-fetch blocking is a conditional add-on applied per the
substrate's *memorization* score; it mirrors SWE-bench's remote-removal step.

### 4. The behavioural oracle

Even if an agent recognises the app, it still has to clear the alert under live
load. Because the fault is authored, recognising the app does not reveal the fix
— and the [behavioural oracle](../closed-loop-verification/) only passes a fix
that actually works. This is what makes eval-awareness unable to inflate the
score.

## Physical harness/substrate separation

Two physically separate trees. The agent **only ever clones the substrate** (a
real repo, hosted in the local forge). The harness — fault injector, load
generator, oracle, confirm-fire gate, scenario definitions, alert rules and the
observability overlay, run scripts — lives in the `sreforge` repo and is **never**
placed inside the substrate.

A single tree that co-locates the app with `scripts/orchestrate.sh` or `// BUG #N`
markers betrays that it is staged — this actually caused a contamination leak
earlier in the project's history, which is why the separation is now a hard rule
(and also a network boundary: the run workspace's only `origin` is the local
forge).

## Neutral, honest framing

Every agent-visible repo is **marker-stripped**: no `BUG#` / `FIXME` / `XXX` /
`HACK` whole-line annotations, no harness references. The planted fault stays in
the code, unlabelled; the catalogue of faults is private. The task framing is a
**plain, honest page or ticket** — no eval/meta language, no "production" theatre.
The agent is never told it's in a harness.

:::note[Disguise is retired]
Earlier designs leaned on a disguise layer — cover org, reskinned services,
re-authored history, personas. That apparatus is **retired**. Choosing genuinely
low-recognizability *real* apps makes it redundant; the anti-cheat is behavioural
verification, not deception.
:::

## Substrate selection — the 3-axis intake gate

Candidate apps pass a three-axis gate (`tools/detell-judge`, all lower-is-better,
run once on a throwaway clone):

| Axis | Question | v1 status |
|---|---|---|
| **rig-confidence** | "Does this look staged?" | **Gated** (threshold 60); real apps pass trivially |
| **recognizability** | "From name-stripped code, would a model recognise it?" | Report-only (gated in v2) |
| **memorization** | "Closed-book, name-only, how much does a tool-less model already know about *this* repo?" | Report-only (gated in v2) — the decisive selection axis |

Memorization is the decisive axis: it catches the trap where a recognisable app
is *also* memorised, which would let an agent diff the deployment against what it
already knows. `booklogr` was chosen as substrate #1 precisely because it scores
low on all three (rig 6 / recog 42 / **memo 3**) — so the eval measures
*capability, not recall*.

:::caution[Avoid the canonical demo apps]
The usual observability demos (OpenTelemetry Demo, Online Boutique, Robot Shop,
Train Ticket) are the *worst* substrates here: maximal memorization and
recognizability, the heaviest topology, and they're already used by other
benchmarks — zero differentiation.
:::

## Next

- [Add a use-case](../../guides/add-a-use-case/) — apply these invariants when
  importing a new app.
