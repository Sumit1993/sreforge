---
title: Closed-loop verification
description: The behavioural oracle that grades whether a fix actually works under sustained fault — SREForge's anti-cheat.
sidebar:
  order: 3
---

Closed-loop behavioural verification is SREForge's signature capability and its
anti-cheat. The rule is simple:

:::tip[The defining property]
The fault stimulus keeps running while the fix is verified. **An alert clears
only because the deployed change works — not because the harness stopped poking
the system.**
:::

You cannot bluff a behavioural oracle. Diff-matching is, at most, a non-blocking
hint — never the grade.

## Why diff-matching isn't enough

A fix that *looks* right can be wrong, and a fix that looks unusual can be
correct. The `latency-cache-stampede` scenario, for instance, accepts several fix
families — restore `SimpleCache`, swap in a real cache backend like Redis, or add
equivalent per-query memoization. The oracle grades **observed behaviour**, not
similarity to the reference patch. This removes a whole class of false negatives
(a correct-but-different fix being marked wrong) and false positives (a
plausible-looking fix that doesn't actually mitigate).

## The closed loop

For an `incident`-profile run:

1. **Inject + confirm fire.** The scenario injects the organic regression and
   confirms the target alert has *actually fired* before the agent is handed
   anything. A non-incident is never handed to an agent.
2. **Agent investigates and submits.** The agent edits its run workspace in place
   and calls `submit`. It never merges or deploys.
3. **CI gate.** Build the fix and run the substrate's existing tests. Red → no
   deploy, the alert persists, the run is rejected (CI output becomes feedback).
4. **Auto-merge → CD redeploy.** On green, the fix is merged and the affected
   service is rebuilt and swapped.
5. **Behavioural verify, under still-active fault.** The mitigation oracle scores
   multi-signal: CI green + the target alert clears + it *stays* cleared for a
   sustained window + time-to-clear + no new alerts.
6. **Record + cleanup.** Persist the verdict; restore the baseline (regressed)
   image for the next run.

:::caution[The load never stops]
During verification the load generator (k6, in constant-arrival-rate mode) keeps
holding an exact request rate regardless of response time. If a fix clears the
alert only momentarily and the alert re-fires under sustained load, the run does
**not** pass. That sustained-clear check is the heart of the anti-cheat.
:::

## The mitigation oracle (v1)

v1 ships a single, fully objective oracle — **no LLM judging**. It scores a
weighted combination of signals; the three *hard* signals dominate:

| Signal | Meaning | Weight |
|---|---|---|
| `ci_green` | Build + smoke succeed (proves deployability) | 0.25 |
| `alert_cleared` | Target alert absent from the firing set after redeploy | 0.35 |
| `sustained_clear` | Stays cleared for the sustained window, load still active | 0.20 |
| `time_to_clear` | Seconds from redeploy to clear (telemetry) | 0.10 |
| `no_new_alerts` | No other alert transitions to firing post-fix | 0.10 |

**The pass bar is a weighted score of `0.85`** — set per scenario as
`pass_threshold` (see [`scenario.toml`](../../reference/scenario-format/)).
Clearing the alert without *holding* it cannot reach that bar: `ci_green` +
`alert_cleared` sum to only 0.60, so a run crosses 0.85 only by also earning
`sustained_clear` (0.20) **and** some soft credit (`time_to_clear`,
`no_new_alerts`) — i.e. by keeping the alert down through the sustained window
while the storm is still running.

A fix that clears the alert briefly but cannot sustain it under the storm scores
at or below the hard-signal ceiling and fails. Fail-closed short-circuits apply:
if CI is not green, or the service was not redeployed after the fix commit, the
run fails outright.

## The compound oracle (the contract)

The oracle is structured as a weighted **compound oracle** spanning the SRE
lifecycle — *detect → diagnose → mitigate*. v1 implements only the **mitigate**
dimension. A `DiagnosisOracle` (an LLM-judge against a structured root cause,
using a separate judge model) drops in later as one more weighted sub-oracle with
no refactor; the submit payload then gains an `rca` field.

## Next

- [Run an incident](../../guides/run-an-incident/) — drive the loop yourself.
- [Run contract](../../reference/run-contract/) — the exact scoring inputs the
  oracle consumes.
- [Design decisions](../../reference/decisions/) — D4 (anti-cheat), D6 (compound
  oracle), D10 (determinism).
