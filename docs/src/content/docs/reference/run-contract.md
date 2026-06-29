---
title: Run contract
description: What a scenario's setup emits and what the engine consumes per run.
sidebar:
  order: 4
---

This is the internal boundary between **scenario setup** and the engine's
`runner` / `verify` / `record`. SREForge *is* the engine (`core/`), so this is not
a contract with an external framework — it's the shape setup hands the engine each
run. The example uses `booklogr`.

## The shape setup emits

```json
{
  "agent_context": {
    "services": {
      "api":          "http://localhost:3000",
      "ui":           "http://localhost:3001",
      "prometheus":   "http://localhost:9090",
      "alertmanager": "http://localhost:9093",
      "grafana":      "http://localhost:3002",
      "loki":         "http://localhost:3100",
      "database_url_env": "DATABASE_URL"
    },
    "run_workspace": {
      "path":    "/work/run/<run-id>/booklogr",
      "service": "booklogr-api",
      "submit":  "sreforge submit"
    }
  },
  "scenario": {
    "id":             "latency-cache-stampede",
    "profile":        "incident",
    "run_id":         "<run-id>",
    "expected_alert": "BooklogrApiLatencyP99High",
    "alert_fired_at": "<ISO timestamp — set by the confirm-fire gate>"
  },
  "eval_only": {
    "alert_to_clear":          "BookApiLatencyP99High",
    "max_clear_time_seconds":  600,
    "sustained_clear_seconds": 60
  }
}
```

## The three sections

### `agent_context` — what the agent receives

Assembled into a neutral brief. The **`run_workspace`** is a per-run copy of the
substrate the agent edits in place; it calls `submit` when done. There is no
`fork_repo`, no PAT, and no github.com in v1. The agent never deploys.

### `scenario` — run metadata

`profile` is `incident` or `patch`. **`alert_fired_at`** is populated by the
**confirm-fire gate**: setup injects the fault and confirms the alert fired
*before* the run is handed to the agent; if it never fires, the run aborts or
retries.

### `eval_only` — scoring inputs, never exposed to the agent

The oracle's inputs. `sustained_clear_seconds` enforces the sustained-clear check.

:::caution[No diff expectations]
There is deliberately **no** `expected_diff_contains` or `expected_files_touched`.
Verification is behavioural; diffs are at most non-blocking hints.
:::

## How a fix is graded (incident profile)

```
submit → CI gate (build + existing tests)
       → green → auto-merge → CD-on-merge redeploy of run_workspace.service
       → mitigation oracle scores, under still-active fault:
           CI green + alert_to_clear clears and stays cleared (sustained_clear_seconds)
           + no new alerts + time-to-clear
```

Multi-signal and fully objective. The diagnosis / RCA LLM-judge (and an `rca`
submit field) arrive in a later version.

## The `patch` profile variant

For `profile: "patch"`, `scenario` carries a pinned `base_commit` and `verify/` is
a hidden test suite run against the agent's patch. There is no live deployment, no
alert, and no `run_workspace` deploy step.

## Forward-compatibility

Additive-only within v1.x: new fields are fine; no rename or removal without a
`contract_version` bump. The engine ignores unknown fields.

## See also

- [Scenario format](../scenario-format/) — the authored side of this contract.
- [Closed-loop verification](../../concepts/closed-loop-verification/) — how the
  oracle uses `eval_only`.
