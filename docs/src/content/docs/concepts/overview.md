---
title: Overview
description: What SREForge is, what it measures, and what it deliberately is not.
sidebar:
  order: 1
---

SREForge is a **contamination-controlled, event-triggered evaluation harness for
autonomous SWE/SRE agents**. It imports a real, lesser-known public app, stands
it up as a lived-in deployment, authors an *organic regression* into its existing
code so a real incident surfaces as a real alert, hands an agent only a short
trigger, lets it investigate through the same tools a human on-call would use,
and grades it on **behavioural recovery — not on matching a reference diff**.

The first substrate is [`Mozzo1000/booklogr`](https://github.com/Mozzo1000/booklogr);
the engine itself is substrate-agnostic.

:::note[Version `0.0.1`]
The version tracks roadmap milestones rather than semver releases — one step per
milestone. `0.0.1` is **v1** (the incident loop, proven end-to-end on booklogr);
**v2** (breadth + research depth) will be `0.0.2`.
:::

## What it measures

A sharp, contamination-free signal of how well an autonomous agent resolves
**under-specified, real-world software incidents** — measured by whether the
system *actually recovers*, across diverse stacks.

The design borrows its diversity strategy from DeepSWE (which draws breadth from
91 real repos): SREForge gets breadth the same way — a **portfolio of imported
real apps** — crossed with `{stack × incident-class}` plus realism tooling.

## What it is not

SREForge is a **harness / benchmark**, not an SRE operations or monitoring
product. It does not watch your production systems; it manufactures controlled,
reproducible incidents to score agents against.

## The shape of a run

An `incident`-profile run is a closed loop:

```
poll trigger → assemble context → run agent → CI gate → auto-merge
   → CD redeploy → behavioural verify → record → cleanup
```

The defining property: **the harness never stops the fault to clear the alert —
only a correct deployed fix can.** That is the anti-cheat. See
[Closed-loop verification](../closed-loop-verification/) for why this matters.

## Where to go next

- [Taxonomy & profiles](../taxonomy/) — the four axes (engine · use-case · stack ·
  scenario) and the two scenario profiles.
- [Closed-loop verification](../closed-loop-verification/) — the signature
  capability and the behavioural oracle.
- [Contamination control](../contamination-control/) — the four cheap invariants
  that make the signal trustworthy.
- [Quickstart](../../guides/quickstart/) — run the reference incident end-to-end.
- [Architecture](../../reference/architecture/) — the engine module map and run
  lifecycle.
