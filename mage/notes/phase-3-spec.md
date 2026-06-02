---
type: spec
tags: [todo-app/phases]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Phase 3 Spec — Seed `prismalens-labs/*` agent-visible repos

> Implementation-ready spec for Phase 3 of [TEST-ENV-PLAN.md](TEST-ENV-PLAN.md). Creates the four agent-visible repos under the `prismalens-labs` org, seeds each with content extracted from this harness, strips dev-annotation comments, applies synthetic history via the Phase 2 generator, populates a small number of GitHub Issues and in-repo incident notes, applies branch protection, sets up forks under the agent bot account, and strips the now-extracted `apps/`/`packages/` from this harness as the final commit.

## Goal

End state:

| Repo | Content seed source | Persona (commits) | Commits | Issues by `Sumit1993` | `docs/incidents/` notes |
|---|---|---|---|---|---|
| `prismalens-labs/todo-api` | `apps/api` + inlined `packages/{core,db}` | arjun | ~90 | 1-3 | 2-3 |
| `prismalens-labs/todo-web` | `apps/ui` | priya | ~50 | 1-3 | 1-2 |
| `prismalens-labs/infra-k8s` | `infra/helm` + `infra/prometheus` | sre | ~30 | 1-2 | 1 |
| `prismalens-labs/platform-runbooks` | hand-authored content (this phase) | sre | ~20 | 0-1 | 0 (this IS the runbooks repo) |

Plus:

- Forks created under `prismalens-labs-agent/{todo-api, todo-web}` (lazy for web — only if frontend bug is in scope at first run).
- Branch protection applied to each upstream `main`.
- `apps/` and `packages/` deleted from this harness in the final commit.

`prismalens-labs/infra-docker` is created in **Phase 4** (not Phase 3) — it holds the active runtime config. `prismalens-labs/infra-kamal` is deferred to v3.

## Preconditions

| Check | Command | Expected |
|---|---|---|
| Phase 1 complete | `gh api orgs/prismalens-labs -q .login` | `prismalens-labs` |
| Phase 2 generator works | `pnpm --filter tools test` | green |
| `gh` has `repo` + `write:org` scope | `gh auth status` | scopes shown |
| `apps/api`, `apps/ui`, `packages/core`, `packages/db` exist in harness | `test -d apps/api && test -d apps/ui && test -d packages/core && test -d packages/db && echo ok` | `ok` (Phase 1 didn't strip them, per Q8) |
| Agent bot PAT available | `echo $PRISMALENS_LABS_AGENT_PAT \| wc -c` | non-zero |

## Inputs

- `HARNESS_PATH = /home/sumit/sources/todo-app/prismalens-agents-harness`
- `WORKSPACE_PATH = /home/sumit/sources/todo-app` (new repos cloned alongside the harness)
- `ORG = prismalens-labs`
- `BOT = prismalens-labs-agent`
- Source content lives in `HARNESS_PATH/apps/` and `HARNESS_PATH/packages/` — directly readable, no `git show` archeology needed.

## Deliverables

### New files inside `HARNESS_PATH`

| Path | Purpose |
|---|---|
| `tools/lib/extract.ts` | Content extraction + dev-annotation strip + workspace-dep rewrite (CLI for Tasks 3.4-3.6) |
| `scripts/lib/extract-to-new-repo.sh` | One-line shell wrapper around `tools/lib/extract.ts` |
| `tools/gen-issues.ts` | Minimal GitHub Issues creator (C+D model — small volume, no PR generation) |
| `tools/issues/pool.json` | Combined pool of issue titles, labels, bodies for all repo types |
| `tools/__tests__/extract.test.ts` | Vitest cases for `extract.ts` |
| `tools/__tests__/gen-issues.test.ts` | Vitest cases for `gen-issues.ts` |

### New GitHub repos under `prismalens-labs`

- `prismalens-labs/todo-api` (public)
- `prismalens-labs/todo-web` (public)
- `prismalens-labs/infra-k8s` (public, parked)
- `prismalens-labs/platform-runbooks` (public)

### New forks under `prismalens-labs-agent`

- `prismalens-labs-agent/todo-api` (always)
- `prismalens-labs-agent/todo-web` (lazy)

### New local clones under `WORKSPACE_PATH`

Each new repo cloned at `WORKSPACE_PATH/<repo-name>/`, added to the workspace file.

## Task list

### Task 3.1 — Build `tools/lib/extract.ts`

Copies a subdirectory from a source tree into a fresh destination, with three transforms:

1. **Recursive copy** excluding `node_modules`, `dist`, `.next`, `.turbo`, `.git`.
2. **Workspace dep inlining** (mode-dependent):
   - Mode `none`: no rewrites.
   - Mode `inline-core-db`: additionally copy `packages/core/src/*` into `<dest>/src/core/`, copy `packages/db/prisma/` into `<dest>/prisma/`. Walk all `*.ts` in `<dest>/src/` and rewrite `from '@todo-app/core'` and `from '@todo-app/db'` to appropriate relative imports based on file depth. Strip `@todo-app/*` deps from `<dest>/package.json` and from devDependencies.
3. **Dev-annotation strip**: walk all `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.yaml`, `*.yml`, `*.toml` files. Delete any **whole line** containing the regex `\b(BUG\s*#|FIXME|XXX|HACK)\b` where the line is inside a comment (matches `//`, `/*`, `*`, `#`). Do NOT touch matches inside markdown (`.md`) — README authors may legitimately use these words. Print: `strip-annotations: removed N lines across M files`.

**CLI signature:**

```
pnpm --filter tools tsx tools/lib/extract.ts \
  --src <abs-path>                 # required, source directory inside the harness
  --dest <abs-path>                # required, destination (must be empty or contain only .git/)
  --mode <none|inline-core-db>     # required
  [--strip-annotations]            # default: true; disable with --no-strip-annotations
```

Exit codes: 0 success, 2 input validation error, 3 destination not empty, 4 source missing, 99 unexpected.

**Tests** (`tools/__tests__/extract.test.ts`):

- `copies files, excludes node_modules and .git`
- `inline-core-db mode pulls core/ and prisma/ correctly`
- `rewrites @todo-app/core imports to relative paths`
- `strips lines containing BUG #, FIXME, XXX, HACK from .ts files`
- `does NOT strip dev annotations from .md files`
- `errors when dest is non-empty`

### Task 3.2 — Build minimal `tools/gen-issues.ts`

The C+D persona model drops most of the originally-planned PR/issue generation. The minimal version creates a small batch of GitHub Issues authored by the maintainer (`Sumit1993`).

**CLI signature:**

```
pnpm --filter tools tsx tools/gen-issues.ts \
  --repo <owner/name>         # required
  --count <N>                 # required, 1..5
  --pool <path>               # required, tools/issues/pool.json
  --pool-type <backend|frontend|infra|runbooks>  # required
  [--closed-ratio <0.0-1.0>]  # default 0.5
  [--seed <N>]
  [--dry-run]
```

Issues are created via `gh issue create` (authored by the authenticated `Sumit1993`). Cache file `tools/.gen-issues-cache.json` tracks (repo, title) pairs to dedup across reruns.

Closed issues get closed via `gh issue close` immediately after creation with a backdated close comment from the same pool.

No PR generation. Per Q2, real PR-shaped artifacts live in `docs/incidents/` markdown (committed by personas via `gen-history.ts`), not as GitHub PRs.

**Tests** (`tools/__tests__/gen-issues.test.ts`):

- `loads pool.json and validates structure`
- `respects --count and --closed-ratio`
- `--dry-run prints planned issues without creating any`
- `cache prevents duplicate creation across reruns`

### Task 3.3 — Author `tools/issues/pool.json`

Single combined file (no per-repo split — small volume):

```json
{
  "backend": {
    "issue_titles": [...20 lines...],
    "issue_labels": ["bug", "enhancement", "documentation", "performance"],
    "issue_bodies": [...6 templates...],
    "close_comments": [...4 lines...]
  },
  "frontend": { ... },
  "infra":    { ... },
  "runbooks": { ... }
}
```

Voice discipline per the realism guideline. Each issue body template can reference variables (`{step1}`, `{observation}`, `{action}`) filled from a small built-in phrase pool in `tools/lib/issue-bodies.ts`.

### Task 3.4 — Create + seed `prismalens-labs/todo-api`

```bash
# 1. Create repo
gh repo create prismalens-labs/todo-api --public \
  --description "Todo REST API — NestJS + PostgreSQL + Valkey" \
  --add-readme=false

# 2. Clone fresh
cd /home/sumit/sources/todo-app
gh repo clone prismalens-labs/todo-api

# 3. Extract content
HARNESS=/home/sumit/sources/todo-app/prismalens-agents-harness
DEST=/home/sumit/sources/todo-app/todo-api
pnpm --filter tools tsx tools/lib/extract.ts \
  --src "$HARNESS/apps/api" \
  --dest "$DEST" \
  --mode inline-core-db

# 4. Sanity checks
grep -rl '@todo-app/' "$DEST/src/" && echo "FAIL: workspace deps still present" && exit 1
grep '@todo-app/' "$DEST/package.json" && echo "FAIL: package.json deps not stripped" && exit 1
grep -rE '\b(BUG\s*#|FIXME|XXX|HACK)\b' "$DEST/src/" && echo "FAIL: annotations not stripped" && exit 1
test -f "$DEST/prisma/schema.prisma" || { echo "FAIL: schema.prisma missing"; exit 1; }
test -f "$DEST/src/core/index.ts" || { echo "FAIL: core/index.ts missing"; exit 1; }

# 5. Initial commit by arjun
cd "$DEST"
git config user.name "Arjun Menon"
git config user.email "arjun.menon@labs.prismalens.io"
git add .
GIT_AUTHOR_DATE="2025-01-15T10:00:00" GIT_COMMITTER_DATE="2025-01-15T10:00:00" \
  git commit -m "initial commit — todo api skeleton"
git push origin main

# 6. Synthetic history
cd "$HARNESS"
pnpm --filter tools tsx gen-history.ts \
  --target "$DEST" \
  --persona arjun \
  --start-date 2025-01-15 --end-date 2026-05-15 \
  --count 90 \
  --corpus tools/messages/backend.txt \
  --force
cd "$DEST"
git push --force-with-lease origin main

# 7. Issues + docs/incidents
cd "$HARNESS"
pnpm --filter tools tsx gen-issues.ts \
  --repo prismalens-labs/todo-api \
  --pool tools/issues/pool.json \
  --pool-type backend \
  --count 2 \
  --closed-ratio 0.5

# Author 2-3 markdown files in $DEST/docs/incidents/ — see Task 3.4b below.
```

**Task 3.4b — Add `docs/incidents/` markdown to todo-api:**

After history is pushed, append 2-3 incident notes by adding files like:

- `docs/incidents/2025-09-postgres-cpu-spike.md` — fictional retrospective written in SRE voice
- `docs/incidents/2025-12-cache-eviction-thrash.md` — references BUG #3 indirectly without naming it
- `docs/incidents/2026-03-deploy-rollback.md` — generic "we rolled back X because Y" postmortem

These are committed with mixed dates via a small follow-up `gen-history.ts` run on just the `docs/incidents/` directory (or committed manually with `GIT_AUTHOR_DATE`). They never reference "test", "eval", "harness", etc.

**DoD for this task:**

```bash
gh api repos/prismalens-labs/todo-api -q .name              # → todo-api
test "$(git -C /home/sumit/sources/todo-app/todo-api log --oneline | wc -l)" -ge "90"
test "$(gh issue list -R prismalens-labs/todo-api --state all --json id -q 'length')" -ge "1"
test -d /home/sumit/sources/todo-app/todo-api/docs/incidents
! grep -r 'BUG #' /home/sumit/sources/todo-app/todo-api/src/
```

### Task 3.5 — Create + seed `prismalens-labs/todo-web`

Same pattern as 3.4 with:

- Repo: `prismalens-labs/todo-web`, description "Todo frontend — Next.js + React"
- Source: `$HARNESS/apps/ui`
- Mode: `none`
- Persona: `priya`
- Initial commit date: `2025-01-20T11:30:00`
- History: `--start-date 2025-01-20 --end-date 2026-05-10 --count 50 --corpus tools/messages/frontend.txt`
- Issues: `--count 2 --pool-type frontend`
- `docs/incidents/`: 1-2 markdown files

### Task 3.6 — Create + seed `prismalens-labs/infra-k8s`

Same pattern with:

- Repo: `prismalens-labs/infra-k8s`, description "Kubernetes manifests, Prometheus rules, Grafana dashboards"
- Source: merged tree of `$HARNESS/infra/helm/` and `$HARNESS/infra/prometheus/` (use `extract.ts` with `--mode none` against a temp directory you build by `cp -r`-ing both into structure `helm/`, `prometheus/`)
- Persona: `sre`
- Initial commit date: `2025-02-01T09:15:00`
- History: `--start-date 2025-02-01 --end-date 2026-05-12 --count 30 --corpus tools/messages/infra.txt`
- Issues: `--count 2 --pool-type infra`
- `docs/incidents/`: 1 markdown file

**Note:** the existing `infra/prometheus/rules/todo-app-rules.yml` ships as-is into this repo. Phase 4 will add new alert rules (`TodoApiLatencyP99High`, `TodoApiPostTodosLatencyHigh`, `TodoApiDeleteErrorRateHigh`) — but those land in `prismalens-labs/infra-docker` (the active topology) in Phase 4. The k8s repo's prometheus/ directory is the parked-for-v2 version.

### Task 3.7 — Create + seed `prismalens-labs/platform-runbooks`

Special case: the PRIMARY content is hand-authored real runbooks. Phase 4 references at minimum `general-investigation.md` from alert `runbookUrl` fields.

**Steps:**

1. `gh repo create prismalens-labs/platform-runbooks --public --description "Runbooks for on-call SREs" --add-readme=false`
2. Clone fresh.
3. Author by hand (do not generate):

**`README.md`:**

```markdown
# Platform Runbooks

On-call runbooks for prismalens-labs services. Each runbook is linked from a Prometheus alert via `runbookUrl`.

## Format

1. **Symptom** — what the alert looks like
2. **Likely causes** — ranked by frequency
3. **Investigation** — concrete commands and queries
4. **Mitigation** — short-term fix
5. **Resolution** — long-term fix
```

**`general-investigation.md`** (THE load-bearing runbook for Phase 4 — referenced by all three new alerts):

```markdown
# Generic investigation runbook — first 5 minutes

When an alert fires and there's no scenario-specific runbook, work through this checklist.

## 1. Confirm the symptom

- Open Alertmanager (port 9093). Note alert name, labels, fire time.
- Cross-reference Prometheus dashboard for the relevant service.

## 2. Recent deploys?

```
git -C /workspace/todo-api log -20 --oneline
git -C /workspace/todo-api log --since="2 hours ago"
```

Look for migrations, config changes, refactors touching the affected code path.

## 3. Logs

```
curl http://loki.local:3100/loki/api/v1/query_range \
  --data-urlencode 'query={job="todo-api"} |= "ERROR"' \
  --data-urlencode 'start=<5min ago in ns>'
```

Patterns to look for: repeated stack traces, retry storms, DB errors.

## 4. DB state

```
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state != 'idle';"
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename = '<affected table>';"
```

## 5. Common patterns

- p99 latency spike + 5xx rate spike on a specific route → likely controller/route bug
- Latency spike with no error rate change → likely DB or cache issue
- Error rate spike without latency → likely upstream dependency or auth failure
- Restart loop → memory or startup failure; check process logs

If the alert clears mid-investigation, file a retrospective in the relevant service repo under `docs/incidents/`.
```

4. Author 2-3 more lightweight runbooks (`latency-spike.md`, `error-rate-elevated.md`, `pod-oom.md`) — single-page each, same format.

5. Initial commit by `sre`, push.

6. Run `gen-history.ts --persona sre --count 20 --corpus tools/messages/infra.txt --start-date 2025-02-15 --end-date 2026-05-10`.

7. `gen-issues.ts --pool-type runbooks --count 1 --closed-ratio 1.0`.

### Task 3.8 — Create forks under the agent bot account

```bash
# Set up the bot's git context locally (one-time)
gh auth login --with-token <<< "$PRISMALENS_LABS_AGENT_PAT"  # or use a separate gh profile

# Fork todo-api (always — primary v1 target)
gh repo fork prismalens-labs/todo-api --org prismalens-labs-agent --clone=false --remote=false

# todo-web fork is lazy — only fork when first frontend bug is in scope.

# Verify
gh api repos/prismalens-labs-agent/todo-api -q .name        # → todo-api
gh api repos/prismalens-labs-agent/todo-api -q .fork        # → true
gh api repos/prismalens-labs-agent/todo-api -q .parent.full_name  # → prismalens-labs/todo-api
```

**DoD:** `gh api repos/prismalens-labs-agent/todo-api -q .fork` returns `true`.

### Task 3.9 — Update the VSCode workspace file

Replace the `folders` array in `WORKSPACE_FILE` (`/home/sumit/sources/todo-app/todo-app.code-workspace`):

```json
{
  "folders": [
    { "path": "prismalens-agents-harness" },
    { "path": "todo-api" },
    { "path": "todo-web" },
    { "path": "infra-k8s" },
    { "path": "platform-runbooks" }
  ]
}
```

(Remove precursor entries `todo-app-api`, `todo-app-ui`, `todo-app-ops` if present.)

### Task 3.10 — Strip `apps/` and `packages/` from the harness

This is the deferred strip from Phase 1 (per Q8).

```bash
cd /home/sumit/sources/todo-app/prismalens-agents-harness
git rm -r apps/ packages/
git status --short  # verify only deletions are staged
git commit -m "chore: extract apps and packages to dedicated repos"
git push origin main
```

This removes everything under `apps/` (including the stubs `api-{python,java,go,firebase,supabase}`) and `packages/` (`core`, `db`, `eslint-config`, `typescript-config`) in one atomic commit. Anything that was extracted now lives in `prismalens-labs/*`; anything that wasn't never had value.

**DoD:** `test ! -d apps && test ! -d packages && echo ok` returns `ok`.

### Task 3.11 — Apply branch protection to each upstream `main`

Must run AFTER `gen-history.ts` has force-pushed each repo (else protection blocks the force-push).

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
  echo "Protected: prismalens-labs/$repo"
done
```

`enforce_admins=false` allows Sumit (org admin) to bypass for inject scenarios that need to push trigger commits. The agent bot is not on the restrictions list, so it cannot push directly to `main` in upstream.

Exact JSON ruleset documented in `internal-docs/branch-protection.md`.

**DoD:** `gh api repos/prismalens-labs/todo-api/branches/main/protection -q .required_pull_request_reviews.required_approving_review_count` returns `1`.

### Task 3.12 — Archive the precursor repos

After all four new repos verify clean:

```bash
gh repo archive Sumit1993/todo-app-api --yes
gh repo archive Sumit1993/todo-app-ui --yes
gh repo archive Sumit1993/todo-app-ops --yes

# Optionally rename for clarity
gh repo rename Sumit1993/todo-app-api _archive-todo-app-api-precursor
gh repo rename Sumit1993/todo-app-ui _archive-todo-app-ui-precursor
gh repo rename Sumit1993/todo-app-ops _archive-todo-app-ops-precursor

# Delete local clones
rm -rf /home/sumit/sources/todo-app/todo-app-api
rm -rf /home/sumit/sources/todo-app/todo-app-ui
rm -rf /home/sumit/sources/todo-app/todo-app-ops
```

## Phase 3 — Definition of Done (rollup)

```bash
# Four new repos exist with expected content
for r in todo-api todo-web infra-k8s platform-runbooks; do
  gh api repos/prismalens-labs/$r -q .name
done

# Commit counts met
test "$(git -C /home/sumit/sources/todo-app/todo-api log --oneline | wc -l)" -ge 90
test "$(git -C /home/sumit/sources/todo-app/todo-web log --oneline | wc -l)" -ge 50
test "$(git -C /home/sumit/sources/todo-app/infra-k8s log --oneline | wc -l)" -ge 30
test "$(git -C /home/sumit/sources/todo-app/platform-runbooks log --oneline | wc -l)" -ge 20

# Personas match expected
test "$(git -C /home/sumit/sources/todo-app/todo-api log --format=%ae -1)" = "arjun.menon@labs.prismalens.io"
test "$(git -C /home/sumit/sources/todo-app/todo-web log --format=%ae -1)" = "priya.shah@labs.prismalens.io"
test "$(git -C /home/sumit/sources/todo-app/infra-k8s log --format=%ae -1)" = "sre@labs.prismalens.io"

# Dev annotations stripped
! grep -rE '\b(BUG\s*#|FIXME|XXX|HACK)\b' /home/sumit/sources/todo-app/todo-api/src/

# Workspace inlining clean
! grep -r '@todo-app/' /home/sumit/sources/todo-app/todo-api/src/
! grep '@todo-app/' /home/sumit/sources/todo-app/todo-api/package.json
test -f /home/sumit/sources/todo-app/todo-api/prisma/schema.prisma
test -f /home/sumit/sources/todo-app/todo-api/src/core/index.ts

# Fork exists
gh api repos/prismalens-labs-agent/todo-api -q .fork                # → true

# Runbook at the expected URL
gh api repos/prismalens-labs/platform-runbooks/contents/general-investigation.md -q .name
                                                                    # → general-investigation.md

# Branch protection applied
for repo in todo-api todo-web infra-k8s platform-runbooks; do
  gh api repos/prismalens-labs/$repo/branches/main/protection \
    -q .required_pull_request_reviews.required_approving_review_count    # → 1 (×4)
done

# apps/ and packages/ no longer in harness
cd /home/sumit/sources/todo-app/prismalens-agents-harness
test ! -d apps && test ! -d packages && echo ok                     # → ok

# Precursor repos archived
test "$(gh api repos/Sumit1993/_archive-todo-app-api-precursor -q .archived)" = "true"

# Workspace file updated
grep -q '"path": "todo-api"' /home/sumit/sources/todo-app/todo-app.code-workspace
! grep -q 'todo-app-api"' /home/sumit/sources/todo-app/todo-app.code-workspace
```

## Idempotency notes

- Repo creation (3.4-3.7): wrap `gh repo create` with `gh api repos/prismalens-labs/<name> >/dev/null 2>&1 || gh repo create ...`.
- Extraction: dest must be empty; clean with `rm -rf $DEST/.git $DEST/[!.]* 2>/dev/null` for re-extraction.
- History: `--force` required per Phase 2.
- Issue creation: deduped via cache.
- Branch protection: re-applying same ruleset is a no-op.
- Fork: `gh repo fork` is idempotent — re-running on an existing fork is no-op.
- Final strip (3.10): not idempotent on a partially-stripped tree; wrap in `[ -d apps ] && git rm -r apps/`.

## Escalation triggers

- Workspace dep rewrite leaves any `@todo-app/` reference in src/ — STOP, extraction has a bug.
- Annotation strip leaves any `BUG #`/`FIXME`/`XXX`/`HACK` in code files — STOP.
- A repo's first push fails permission — confirm org membership and PAT scopes.
- `gen-issues` rate-limit — throttle (sleep 2s between creates).
- Branch protection PUT fails — verify token has `admin:org` or repo-admin perms.
- Runbook content reads as machine-generated — STOP and rewrite by hand.
