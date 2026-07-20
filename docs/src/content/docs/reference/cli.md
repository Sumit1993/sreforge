---
title: CLI — pnpm forge
description: The neutral use-case dispatcher — verbs, composites, stack resolution, and argument handling.
sidebar:
  order: 1
---

The whole rig lifecycle is driven through one neutral dispatcher:

```
pnpm forge <verb> <use-case>[:<stack>] [task-args…]
```

The **verb** is the stable, use-case-agnostic vocabulary; the **use-case** is a
parameter. Nothing at the engine or repo-root layer names a specific use-case —
adding one is `mkdir use-cases/<name>/…`, with no new script.

:::note[Why a dispatcher, not bare `pnpm <verb>`]
`pnpm up` aliases `pnpm update`, `pnpm setup` configures pnpm itself, and `pnpm
run` is reserved — bare verb scripts get hijacked. go-task's `includes:` would
give `task booklogr:setup`, which is use-case-*first* again. The `forge` shim sits
above go-task and gives a neutral, verb-first surface; go-task still does the
actual lifecycle work per the stack's `Taskfile.yml`.
:::

## Phase verbs

Each phase verb maps to a task in the stack's `Taskfile.yml`:

| Verb | Purpose |
|---|---|
| `setup` | One-time substrate import + scaffolding |
| `up` | Bring up the deployment + observability stack |
| `arm` | Inject the fault and confirm the target alert fires |
| `agent` | Bring up the sealed agent sandbox |
| `mcp` | Start the optional read-only Grafana MCP telemetry seam |
| `auto` | Automated incident cycle: alert push → agent → grade (ADR-0025) |
| `run` | Drive a graded run (scripted, or `RUNNER=external`) |
| `verify` | Behavioural verification + boundary / de-tell probes |
| `down` | Tear down the deploy + load planes |
| `status` | Report current stack state |
| `console` | Harness-side operator console (status + deep-links) |
| `smoke` | Quick positive/negative smoke checks |

## Cross-use-case verbs

| Verb | Purpose |
|---|---|
| `dashboard` | Spawns the cross-use-case operator control plane (`tools/dashboard`, ADR-0024) |

## Composite verbs

Composites expand to an ordered sequence of phase verbs:

| Composite | Expands to |
|---|---|
| `fresh` | `setup → up` |
| `agent-up` | `arm → agent` |
| `incident` | `arm → run → verify` |
| `e2e` | `setup → up → arm → run → verify → down` |

## Arguments

Trailing task args are passed through to the underlying task. **Inside a
composite, they flow only to the `run` phase.**

```sh
pnpm forge up booklogr                      # single phase
pnpm forge run booklogr RUNNER=external id=r1   # args → the run task
pnpm forge incident booklogr                # composite: arm → run → verify
```

## Stack resolution

`<use-case>[:<stack>]` resolves to a stack directory under
`use-cases/<name>/stacks/`:

- If the use-case has exactly one stack, you can omit `:<stack>`.
- If it has more than one, you must address one explicitly as `name:stack`,
  otherwise the dispatcher errors and lists the available stacks.

## Listing phases

```sh
pnpm forge menu booklogr     # alias: list — runs `task --list` for the stack
```

## Related repo-root scripts

These are plain Node scripts (no install needed) used during substrate intake:

| Script | What it does |
|---|---|
| `pnpm guard` | Contamination-guard: scan a target for harness leakage + marker comments |
| `pnpm guard:strict` | The strict variant |
| `pnpm detell` | De-tell judge: score a target for "is this a rig?" tells |
| `pnpm detell:grade` | The grading variant |
| `pnpm certify:hash` | Computes the ADR-0026 `own_hash` and `shared_hash` for a scenario |
| `pnpm certify:validate` | Validates acceptance manifests against their versioned schema |
| `pnpm test:*` | Runs suite-specific tests (e.g., `test:certify`, `test:core`) |
| `node tools/record/migrate-run-records.mjs` | Migrates older run records to the canonical snake_case `run-record.v1` schema |
| `node tools/transcript/write-handoff.mjs` | Driver contract script to hand off agent transcript/RCA to the engine |

## See also

- [Run an incident](../../guides/run-an-incident/) — verbs mapped to lifecycle
  phases.
