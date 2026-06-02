---
type: decision
tags: [todo-app/decisions]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Branch protection — `prismalens-labs/*` repos

> Exact ruleset applied to each upstream repo's `main` branch at the end of Phase 3.

## Applied to

- `prismalens-labs/todo-api`
- `prismalens-labs/todo-web`
- `prismalens-labs/infra-k8s`
- `prismalens-labs/infra-docker`
- `prismalens-labs/platform-runbooks`

NOT applied to:

- `prismalens-labs-agent/*` forks (no protection — branches are intentionally ephemeral)
- `Sumit1993/prismalens-agents-harness` (private harness — single-author, no protection needed)

## Ruleset (per repo)

```yaml
required_pull_request_reviews:
  required_approving_review_count: 1
  dismiss_stale_reviews: true
  require_code_owner_reviews: false
required_status_checks: null     # v1; future scenarios may gate on agent-pr-validation.yml
enforce_admins: false             # allows Sumit (admin) to bypass for inject scenarios
restrictions:
  users: [Sumit1993]              # only Sumit can push to main (admin bypass)
  teams: []
  apps: []
allow_force_pushes: false
allow_deletions: false
```

## Why each setting

| Setting | Reason |
|---|---|
| `required_approving_review_count: 1` | Defense-in-depth. Agent's PRs are closed (not merged) so this rarely fires in practice, but it prevents accidental merge by automation. |
| `dismiss_stale_reviews: true` | If an agent updates its PR with a new commit, prior approval is invalidated. |
| `required_status_checks: null` | v1 has no required CI gate. Future scenarios may add `.github/workflows/agent-pr-validation.yml` and gate on it. |
| `enforce_admins: false` | Sumit (org admin) bypasses required PRs. This lets future scripted scenarios push trigger commits directly to main without spinning up PR ceremony. |
| `restrictions.users: [Sumit1993]` | Only Sumit's user account can push to `main` (combined with admin bypass). The agent bot (`prismalens-labs-agent`) is NOT on the list — it cannot push to upstream main at all. |
| `allow_force_pushes: false` | No history rewrites on main. `gen-history.ts`'s force-pushes happen BEFORE protection is applied (Phase 3 Task 3.11). |
| `allow_deletions: false` | Cannot delete the `main` branch. |

## Timing

Branch protection is applied **at the end of Phase 3, after `gen-history.ts` has force-pushed the synthetic history**. Applying it earlier would block the force-push and require admin bypass for every history regeneration.

## Application command

```bash
for repo in todo-api todo-web infra-k8s platform-runbooks; do
  gh api -X PUT "repos/prismalens-labs/$repo/branches/main/protection" \
    -F required_status_checks=null \
    -F enforce_admins=false \
    -F required_pull_request_reviews[required_approving_review_count]=1 \
    -F required_pull_request_reviews[dismiss_stale_reviews]=true \
    -F restrictions[users][]=Sumit1993 \
    -F restrictions[teams][]= \
    -F restrictions[apps][]= \
    -F allow_force_pushes=false \
    -F allow_deletions=false
done
```

`prismalens-labs/infra-docker` gets the same ruleset, applied at end of Phase 4 (since it's created in Phase 4).

## Verification

```bash
for repo in todo-api todo-web infra-k8s infra-docker platform-runbooks; do
  echo "=== $repo ==="
  gh api repos/prismalens-labs/$repo/branches/main/protection \
    -q '{
      required_reviews: .required_pull_request_reviews.required_approving_review_count,
      enforce_admins: .enforce_admins.enabled,
      restricted_users: .restrictions.users[].login,
      force_push_allowed: .allow_force_pushes.enabled,
      delete_allowed: .allow_deletions.enabled
    }'
done
```

Expected output per repo:

```json
{
  "required_reviews": 1,
  "enforce_admins": false,
  "restricted_users": "Sumit1993",
  "force_push_allowed": false,
  "delete_allowed": false
}
```

## When to revisit

- When the first scripted scenario needs a trigger commit (none in v1; v2's first migration-related scenario will exercise admin bypass)
- When CI gates are introduced (`required_status_checks` becomes non-null)
- When a second human collaborator joins (`restrictions.users` grows)
