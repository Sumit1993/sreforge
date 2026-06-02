---
type: playbook
tags: [todo-app/workflow]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Agent contribution workflow

> How the agent under test contributes its recommended fix, how the harness validates it, and how the trace is cleaned up without polluting upstream.

## Identity model

The agent under test is given:

- A fine-grained PAT (`PRISMALENS_LABS_AGENT_PAT`) belonging to the `prismalens-labs-agent` machine user account.
- Scoped permissions: `contents: write` on the bot's forks, `pull_requests: write` on `prismalens-labs/*`.
- NO access to `Sumit1993/prismalens-agents-harness` (the private harness repo).
- NO admin scope (cannot bypass branch protection, cannot modify upstream repo settings).

## Contribution flow

```
1. Eval framework calls scripts/setup.sh latency-retry-storm
   → harness starts inject, emits JSON contract
2. Eval framework polls Alertmanager until alert fires
3. Eval framework invokes the agent under test, passing it agent_context
4. Agent investigates:
   - Clones the listed upstream repos OR uses pre-cloned working trees
   - Queries Prometheus, Alertmanager, Loki, Grafana via service URLs
   - Reads git log, browses issues, follows the runbook
5. Agent identifies the bug + proposes a fix
6. Agent commits to its fork:
   git clone https://<PAT>@github.com/prismalens-labs-agent/todo-api
   cd todo-api
   git checkout -b agent-attempt/<run-id>
   <edit files>
   git commit -m "<fix message>"
   git push origin agent-attempt/<run-id>
7. Agent opens PR upstream:
   gh pr create -R prismalens-labs/todo-api \
     --base main \
     --head prismalens-labs-agent:agent-attempt/<run-id> \
     --title "..." --body "..."
8. Eval framework reads the PR diff and grades the agent
9. Eval framework calls scripts/teardown.sh latency-retry-storm
   → harness cleans up PR + branch + upstream PR record
```

## Branch protection enforcement

`prismalens-labs/<repo>/main` is protected (see [`branch-protection.md`](branch-protection.md)) with:

- Required PRs (the agent cannot push directly to `main`)
- 1 approving review required
- Sumit1993 (org admin) can bypass for inject scenarios that need trigger commits (none in v1 — `latency-retry-storm` is load-only)
- Force-pushes and deletions disabled

The agent's PRs are reviewed/closed by the eval framework, never merged. Branch protection is mostly defense-in-depth — even if the eval framework had a bug that tried to merge, branch protection's required-review would block it.

## Cleanup contract — "without a trace"

After a successful test run, `scripts/teardown.sh` invokes `scripts/lib/cleanup-fork.sh`, which performs:

### Op 1 — Close PR + delete fork branch

```bash
gh pr close --repo prismalens-labs/todo-api --delete-branch <PR-number>
```

This closes the PR (without merging) and deletes the head branch from the fork. The PR record persists in upstream's "closed" PR list.

### Op 2 — Delete upstream PR record

```bash
gh api graphql -f query='
  mutation($id: ID!) {
    deletePullRequest(input: {pullRequestId: $id}) {
      repository { id }
    }
  }
' -F id="<PR-node-id>"
```

This permanently deletes the closed PR record from upstream's PR list. **Requires admin scope** — runs with Sumit1993's PAT (not the agent bot's). The agent never has access to this scope.

### Op 3 — Periodic fork wipe (every 10 successful runs)

```bash
gh repo delete prismalens-labs-agent/todo-api --yes
gh repo fork prismalens-labs/todo-api --org prismalens-labs-agent --clone=false --remote=false
```

This wipes any stale state in the fork that ops 1+2 might miss (orphaned branches, accumulated git objects). Triggered by a counter file in `.harness-state/run-counter.txt`.

## On test failure

`teardown.sh` is **never called automatically** on test failure. The eval framework's contract is to skip teardown when the agent's PR didn't pass validation. This preserves:

- The agent's branch in the fork (for post-mortem diff inspection)
- The upstream PR (for review)
- The running scenario state (for reproducing the failure)

Manual teardown is the recovery path:

```bash
./scripts/teardown.sh latency-retry-storm
```

## Two-PAT model

| PAT | Owner | Used by | Scope |
|---|---|---|---|
| `PRISMALENS_LABS_AGENT_PAT` | `prismalens-labs-agent` | The agent under test (for its git push + PR create) | `contents:write` on forks, `pull_requests:write` on `prismalens-labs/*` |
| Sumit's admin PAT (stored as `SUMIT_ADMIN_PAT`) | `Sumit1993` | Harness teardown script for op 2 (GraphQL PR deletion) | `repo` + `delete_repo` |

The harness's `cleanup-fork.sh` reads from `$SUMIT_ADMIN_PAT` (or falls back to `gh auth` if Sumit is logged in locally). The agent NEVER has access to Sumit's PAT.

## Fork lifecycle summary

| Event | Mechanism |
|---|---|
| Fork created (Phase 3) | `gh repo fork prismalens-labs/todo-api --org prismalens-labs-agent` once |
| Branch created per run | Agent does `git checkout -b agent-attempt/<run-id>` |
| Branch deleted per teardown | Op 1 — `gh pr close --delete-branch` |
| PR record deleted per teardown | Op 2 — GraphQL `deletePullRequest` |
| Full fork wipe | Op 3 — every 10 runs via counter file |
