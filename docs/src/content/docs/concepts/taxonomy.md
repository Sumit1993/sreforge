---
title: Taxonomy & profiles
description: The four axes of SREForge — engine, use-case, stack, scenario — and the two scenario profiles.
sidebar:
  order: 2
---

SREForge separates *what stays constant* from *what varies* along four axes. New
coverage is always new use-cases, stacks, or scenarios — never an engine rewrite.

## The four axes

| Layer | What it is | Example |
|---|---|---|
| **Engine** (`core/`) | The domain-agnostic orchestration: trigger → context → run → verify → record → cleanup, plus the deploy step. | SREForge itself |
| **Use-case** | An imported real app and its problem domain. | `booklogr` |
| **Stack** | The app's `service-language × topology` realization. | Flask + React + Postgres on Docker Compose (`flask-compose`) |
| **Scenario** | One **authored organic regression** with a `profile`. | `latency-cache-stampede` |

The engine never names a concrete substrate. Adding a use-case is
`mkdir use-cases/<name>/…` plus its stack and scenarios — no new engine code, and
no new top-level script (the [CLI](../../reference/cli/) dispatches by parameter).

## The two scenario profiles

Every scenario carries a `profile`. Both share one folder shell; the
`environment/` and `verify/` contents differ.

### `incident` — the signature capability

A live deployment with observability. The organic regression is injected, an
alert fires, and verification is **behavioural and closed-loop**: the agent's
deployed fix must clear the alert *under still-active fault*. The substrate must
be deployable and observable.

This is SREForge's distinguishing feature and the focus of v1. See
[Closed-loop verification](../closed-loop-verification/).

### `patch` — the diversity engine

DeepSWE-style: a pinned real repo, an `instruction`, a hidden `tests/` suite, and
a reference `solution/`. Test-graded, with no live system. Because there is no
deployment to stand up, the substrate can be *any* public repo — libraries are
fine — so this profile drives breadth cheaply.

The `patch` profile's contracts are baked in; v1 implements `incident` only.

## Two independent choices

It helps to see the two design knobs as orthogonal:

- **Axis 1 — substrate source:** public (imported) vs. self-built.
- **Axis 2 — grading mechanism:** static-test (`patch`) vs. deploy-and-verify
  (`incident`).

They are chosen independently. v1 fixes Axis 1 to *imported real app* and Axis 2
to *deploy-and-verify*.

## Next

- [Closed-loop verification](../closed-loop-verification/) — how `incident`
  scoring resists cheating.
- [Scenario format](../../reference/scenario-format/) — the on-disk shape of a
  scenario.
- [Design decisions](../../reference/decisions/) — D1 (taxonomy) and D3 (profiles)
  in full.
