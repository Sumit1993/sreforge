---
type: interface
tags: [todo-app/eval]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Eval framework contract

> The JSON contract between `scripts/setup.sh` (in this harness) and the eval framework consuming it (lives in the agent-under-test's repo, outside this harness).

## Why this exists

The harness exposes a minimal CLI contract. The eval framework (which orchestrates test runs of the PrismaLens agent) shouldn't need to read this harness's source — it should only need this document plus `setup.sh --help`.

## Contract surface

Three CLI scripts and their outputs:

| Script | Input | Output |
|---|---|---|
| `scripts/setup.sh <scenario-id>` | scenario id | JSON contract to stdout; non-zero exit on failure |
| `scripts/teardown.sh <scenario-id> [--hard]` | scenario id, optional hard-reset flag | Side effects (env reset, PR cleanup); zero exit on success |
| `scripts/status.sh` | none | Human-readable env state to stdout |

## JSON contract emitted by `setup.sh`

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
    "repos": [
      "prismalens-labs/todo-api",
      "prismalens-labs/todo-web",
      "prismalens-labs/infra-k8s",
      "prismalens-labs/infra-docker",
      "prismalens-labs/platform-runbooks"
    ],
    "agent_workspace": {
      "upstream_repo":  "prismalens-labs/todo-api",
      "fork_repo":      "prismalens-labs-agent/todo-api",
      "branch_name":    "agent-attempt/<run-id>",
      "pat_env_var":    "PRISMALENS_LABS_AGENT_PAT"
    }
  },
  "scenario": {
    "id":             "latency-retry-storm",
    "class":          "scripted",
    "run_id":         "2026-05-24T15-33-21Z-abc123",
    "expected_alert": "TodoApiLatencyP99High",
    "alert_fired_at": null
  },
  "eval_only": {
    "alert_to_clear":         "TodoApiLatencyP99High",
    "max_clear_time_seconds": 600
  }
}
```

### Section breakdown

**`agent_context`** — context the eval framework should pass to the agent under test. Represents what a real SRE/dev would have at the start of an investigation.

**`scenario`** — metadata about the current run. The eval framework decides how much of this to expose to the agent (typically none — the agent should discover the scenario themselves from the alerting symptom).

**`eval_only`** — used by the eval framework to score the agent's response. **NEVER pass these fields to the agent under test** — they reveal the expected fix and the success criteria.

### Latent-bug scenarios (alternate scenario class)

For a latent bug (Bug A or Bug B), the scenario section differs:

```json
"scenario": {
  "id":             "bug-b-parseintpipe",
  "class":          "latent",
  "run_id":         "2026-05-24T15-33-21Z-abc123",
  "expected_alert": "TodoApiDeleteErrorRateHigh",
  "alert_fired_at": null,
  "trigger_hint":   "Navigate the UI to /todos/<any non-integer string>"
}
```

`alert_fired_at: null` because `setup.sh` for latent bugs only confirms baseline is deployed; the trigger comes from the eval framework's own UI driver (Playwright, etc.) which then polls Alertmanager for fire.

## Per-deployment configuration

Service URLs and DB connection details are read from `harness/env-config.yaml` at setup time. The default `env-config.yaml` ships with local-Docker values; alternate configs (`env-config.cloud.yaml`, `env-config.staging.yaml`) can be selected via `HARNESS_ENV_CONFIG=<path> scripts/setup.sh <scenario>`.

This isolates the contract shape (stable) from the deployment specifics (variable).

## Forward-compatibility policy

The harness commits to **additive-only** changes in the v1.x contract:

- New fields may be added to any object.
- Existing fields are never renamed or removed without a contract version bump.
- The eval framework should ignore unknown fields gracefully.

Breaking changes (rename, removal, type change) require a v2 contract, which would be signaled via a top-level `contract_version: 2` field. The current contract is implicitly v1 (no version field).

## Consumer obligations

The eval framework using this contract must:

1. Pass `agent_context` to the agent under test (or a subset thereof — at minimum, the alert URL and the repos).
2. NOT pass `eval_only` to the agent.
3. Call `teardown.sh` ONLY on test success. On failure, leave the env alone for post-mortem.
4. Set `PRISMALENS_LABS_AGENT_PAT` in the agent's environment (for the agent's git push to its fork).
5. Drive UI triggers for `scenario.class == "latent"` runs (the harness doesn't do this).
