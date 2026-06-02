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

# Phase 1 Spec — GitHub org + harness rename

> Implementation-ready spec for Phase 1 of [TEST-ENV-PLAN.md](TEST-ENV-PLAN.md). An executing agent can complete Phase 1 using only this document plus access to the listed paths and credentials.

## Goal

Move this monorepo from its current confused state (a single repo containing both product code and orchestration tooling) to the target separation:

- This repo, renamed to `prismalens-agents-harness`, made private, contains the admin/orchestration layer (scripts, scenarios, generators, internal docs). Application code (`apps/*`, `packages/*`) **remains in place during Phase 1** — it is stripped at the end of Phase 3, after content is extracted to the new `prismalens-labs/*` repos.
- A new GitHub organization `prismalens-labs` exists (empty — repos created in Phase 3).
- A machine user account `prismalens-labs-agent` exists (empty — forks created in Phase 3).
- Persona identities are documented for use in Phase 2's generator and Phase 3's seeding.

## Preconditions

| Check | Command | Expected |
|---|---|---|
| `gh` CLI installed and authenticated | `gh auth status` | `Logged in to github.com as Sumit1993` |
| `gh` has org-create scope | `gh auth status` | scopes include `admin:org` (or `gh auth refresh -s admin:org,write:org`) |
| Working tree clean | `git -C /home/sumit/sources/todo-app/todo-app-monorepo status --short` | empty |
| Remote in sync | `git -C /home/sumit/sources/todo-app/todo-app-monorepo status -b --short` | `## main...origin/main` no ahead/behind |
| `pnpm` available | `pnpm --version` | non-error |

If any precondition fails, STOP and surface the gap.

## Inputs

- `MONOREPO_PATH = /home/sumit/sources/todo-app/todo-app-monorepo` (current local clone, renamed locally in Task 1.10)
- `HARNESS_PATH = /home/sumit/sources/todo-app/prismalens-agents-harness` (target local path after rename)
- `WORKSPACE_FILE = /home/sumit/sources/todo-app/todo-app.code-workspace` (VSCode workspace, needs path update)
- `GH_USER = Sumit1993`
- `ORG_NAME = prismalens-labs` (verified available via `gh api orgs/prismalens-labs` → 404)
- `BOT_USER = prismalens-labs-agent` (new machine-user account)

## Task list (in execution order)

### Task 1.1 — Create `prismalens-labs` GitHub org

**Why:** the agent-visible "labs" namespace needs an org separate from `prismalens` (production) and from the maintainer's personal account.

**Steps:**

1. Re-check availability: `gh api orgs/prismalens-labs 2>&1 | grep -q "Not Found" && echo "available" || echo "TAKEN — pick a new name"`.
2. If available: `gh` does not support org creation via API for free-tier orgs. Create via web at https://github.com/organizations/plan (select Free plan, set the billing email to your account email). Wait for user confirmation before continuing.
3. Verify: `gh api orgs/prismalens-labs -q .login` returns `prismalens-labs`.

**DoD:** `gh api orgs/prismalens-labs -q .login` returns `prismalens-labs`.

### Task 1.2 — Create the agent bot machine user account

**Why:** the eval lifecycle requires a separate GitHub account to own the forks where the agent under test pushes its PR-attempt branches. Per GitHub ToS, a single human may register one personal account plus one or more machine-user accounts (explicitly permitted).

**Steps:**

1. Use a gmail-alias email for signup: `sumitpatel.14may+pl-labs-agent@gmail.com` (or any alias the operator prefers).
2. Sign up at https://github.com/signup with username `prismalens-labs-agent`.
3. Add "Machine user account — automation for prismalens-labs eval fixture" to the bio (ToS compliance signal).
4. Generate a fine-grained PAT scoped to `prismalens-labs/*` and the bot's own repos, with permissions:
   - `contents: write` (on the bot's forks)
   - `pull_requests: write` (on `prismalens-labs/*`)
5. Save the PAT into the operator's secret store (1Password, password manager, etc.) under the name `PRISMALENS_LABS_AGENT_PAT`. The harness reads this at PR-cleanup time.
6. Add `prismalens-labs-agent` as a member of the `prismalens-labs` org (Settings → People → Invite member).

**DoD:** `gh api users/prismalens-labs-agent -q .login` returns `prismalens-labs-agent`. The PAT is stored and accessible to the operator.

### Task 1.3 — Document personas

**Why:** persona identities are referenced by Phase 2's generator and used by humans for real commits later. Document them once, reuse.

**Steps:**

1. Create `MONOREPO_PATH/internal-docs/personas.md` (see [personas.md](personas.md) for the canonical content — written by this spec as part of Phase 1 itself).
2. Create `MONOREPO_PATH/tools/personas.json`:

```json
{
  "arjun": { "name": "Arjun Menon", "email": "arjun.menon@labs.prismalens.io" },
  "priya": { "name": "Priya Shah",  "email": "priya.shah@labs.prismalens.io" },
  "sre":   { "name": "SRE",         "email": "sre@labs.prismalens.io" },
  "sumit": { "name": "Sumit Patel", "email": "(maintainer real email — not used for synthetic history)" }
}
```

3. `git add internal-docs/personas.md tools/personas.json`.

**DoD:** both files exist, staged.

### Task 1.4 — Snapshot the original SPEC.md to archive

**Why:** SPEC.md is rewritten + relocated to `internal-docs/SPEC.md` in Task 1.6. Preserve the original.

**Steps:**

1. If `internal-docs/SPEC-v1-archive.md` already exists, skip — done.
2. Otherwise, with the original SPEC.md still at the repo root, run:
   ```bash
   { echo "> Archived snapshot of the original SPEC.md before the Phase 1 rewrite (see TEST-ENV-PLAN.md)."; echo ""; cat MONOREPO_PATH/SPEC.md; } > MONOREPO_PATH/internal-docs/SPEC-v1-archive.md
   ```
3. `git add internal-docs/SPEC-v1-archive.md`.

**DoD:** `internal-docs/SPEC-v1-archive.md` exists, byte-equivalent to original SPEC.md plus a two-line header.

### Task 1.5 — Create new harness directory scaffolding

**Why:** placeholders for what Phase 2-4 will populate.

**Steps:**

1. Create directories: `scenarios/`, `tools/`, `scripts/lib/`, `scripts/scenarios/`, `harness/`.
2. Write `MONOREPO_PATH/scenarios/README.md`:

```markdown
# Scenarios

Each scenario is a YAML file describing a scripted incident. Schema defined fully in Phase 4.

- `id`: scenario key
- `description`: human-readable
- `trigger`: what setup.sh does to inject
- `expected_alert`: which Prometheus alert should fire
- `artifacts`: list of git commits, log patterns, dashboards expected to surface
- `reset`: what teardown.sh does
```

3. Write `MONOREPO_PATH/tools/README.md`:

```markdown
# tools/

Internal generators and helpers. Not shipped, not consumed externally.

- `gen-history.ts` — synthetic git history generator (Phase 2)
- `lib/extract.ts` — content extraction with comment-strip (Phase 3)
- `personas.json` — persona registry
- `messages/` — commit message corpora per repo type
```

4. Write `MONOREPO_PATH/harness/env-config.yaml` (skeleton):

```yaml
# Per-deployment configuration. Read by setup.sh to construct the JSON contract.
# v1 default: local Docker Compose on the operator's workstation.

deployment_kind: local-docker
service_base_url: http://localhost
ports:
  api: 3000
  ui: 3001
  prometheus: 9090
  alertmanager: 9093
  grafana: 3002
  loki: 3100
db:
  host: localhost
  port: 5432
  name: tododb
  user: todo
  password_env: POSTGRES_PASSWORD
agent_workspace:
  upstream_org: prismalens-labs
  fork_owner: prismalens-labs-agent
  branch_prefix: agent-attempt/
  pat_env: PRISMALENS_LABS_AGENT_PAT
```

5. `git add scenarios/ tools/ scripts/ harness/`.

**DoD:** `find scenarios tools scripts harness -type f` lists at minimum: `scenarios/README.md`, `tools/README.md`, `harness/env-config.yaml`.

### Task 1.6 — Write `internal-docs/SPEC.md` (relocated from root)

**Why:** the original SPEC.md (1192 lines at repo root) describes 7 services × 5 topologies. The new SPEC is short, lives in `internal-docs/SPEC.md` alongside the other authoritative docs, and describes the realistic v1 scope with the Extension model for v2+.

**Steps:**

1. If `internal-docs/SPEC.md` already exists (with the sections listed in the template below), skip steps 2–3.
2. Otherwise, write `MONOREPO_PATH/internal-docs/SPEC.md` with the template content below. Keep under 50 lines. Links in "Where to find more" use bare filenames (no `internal-docs/` prefix) since SPEC.md is now inside that directory.
3. If `MONOREPO_PATH/SPEC.md` still exists at repo root, delete it: `rm MONOREPO_PATH/SPEC.md`.
4. Stage: `git add internal-docs/SPEC.md` (and `git rm SPEC.md` if it was tracked).

Template content for `internal-docs/SPEC.md`:

```markdown
# prismalens-agents-harness — scope and status

> Private orchestration harness for the `prismalens-labs` eval namespace. Public-facing repos live under https://github.com/prismalens-labs.

## What this repo is

The admin/orchestration layer for an eval fixture targeting the [PrismaLens AI investigation agent](https://github.com/prismalens/prismalens-agents). Contains setup/teardown scripts, scenario definitions, history generators, and internal docs. Never exposed externally.

## What `prismalens-labs/*` repos are (agent-visible)

| Repo | Purpose |
|---|---|
| todo-api | NestJS REST API (active) |
| todo-web | Next.js frontend (active) |
| infra-k8s | Helm + Prometheus + Grafana for K8s (parked, v2) |
| infra-docker | Docker Compose staging (active v1 topology) |
| platform-runbooks | SRE runbooks referenced from alerts |

## Current scope (v1)

- 2 services: `todo-api`, `todo-web`
- 1 topology: Docker Compose
- 1 scripted scenario: `latency-retry-storm`
- 2 latent bugs (user-UI-triggered)

## Where to find more

- `internal-docs/TEST-ENV-PLAN.md` — full architecture and phasing
- `internal-docs/personas.md` — persona identities
- `internal-docs/extension-recipes.md` — how to add services / topologies / scenarios
- `internal-docs/roadmap.md` — planned future extensions
- `internal-docs/SPEC-v1-archive.md` — pre-rewrite snapshot of original SPEC.md
```

(This template may drift from the canonical `internal-docs/SPEC.md`. The canonical file is authoritative; this template is a reference at spec-write time. To regenerate, copy the body of `internal-docs/SPEC.md` between the markdown fences.)

**DoD:** `internal-docs/SPEC.md` exists, under 50 lines. Root `SPEC.md` no longer exists.

### Task 1.7 — Commit the scaffolding

**Steps:**

1. Verify staged content with `git status --short`. Expected:
   - `A internal-docs/personas.md`, `A internal-docs/SPEC-v1-archive.md`, `A internal-docs/SPEC.md`
   - `D SPEC.md` (root SPEC.md deleted; content moved to `internal-docs/SPEC.md`)
   - `A scenarios/README.md`, `A tools/README.md`, `A tools/personas.json`
   - `A harness/env-config.yaml`
2. **Verify `apps/` and `packages/` are NOT staged for deletion** — they stay until end of Phase 3.
3. Commit: `git commit -m "chore: scaffold admin harness structure, relocate SPEC.md to internal-docs/, document personas"`
4. `git log --oneline -1`.

**DoD:** HEAD commit message starts with `chore: scaffold admin harness`.

### Task 1.8 — Rename the GitHub repo

**Steps:**

1. From inside `MONOREPO_PATH`: `gh repo rename prismalens-agents-harness --yes`
2. Verify: `gh repo view --json name -q .name` returns `prismalens-agents-harness`.
3. `gh repo rename` updates the local `origin` URL automatically.
4. Verify: `git remote get-url origin` reflects the new name.

**DoD:** `gh api repos/Sumit1993/prismalens-agents-harness -q .name` returns `prismalens-agents-harness`. Legacy URL redirects.

### Task 1.9 — Make the GitHub repo private

**Steps:**

1. `gh repo edit Sumit1993/prismalens-agents-harness --visibility private --accept-visibility-change-consequences`
2. Verify: `gh repo view --json visibility -q .visibility` returns `PRIVATE`.

**DoD:** `gh repo view --json visibility -q .visibility` returns `PRIVATE`.

### Task 1.10 — Rename the local directory

**Steps:**

1. `cd /home/sumit/sources/todo-app`
2. `mv todo-app-monorepo prismalens-agents-harness`
3. `ls -d /home/sumit/sources/todo-app/prismalens-agents-harness` succeeds.

**DoD:** new path exists; old path does not.

### Task 1.11 — Update the VSCode workspace file

**Steps:**

1. Edit `WORKSPACE_FILE`.
2. Find `{ "path": "todo-app-monorepo" }` in the `folders` array.
3. Replace with `{ "path": "prismalens-agents-harness" }`.

**DoD:** `grep -c 'todo-app-monorepo' WORKSPACE_FILE` returns `0`; `grep -c 'prismalens-agents-harness' WORKSPACE_FILE` returns `1`.

### Task 1.12 — Push

**Steps:**

1. `git -C /home/sumit/sources/todo-app/prismalens-agents-harness push origin main`
2. `git status -b --short` shows no divergence.

**DoD:** `git rev-list --count origin/main..HEAD` returns `0`.

## Phase 1 — Definition of Done (rollup)

```bash
# Org + bot exist
gh api orgs/prismalens-labs -q .login                                       # → prismalens-labs
gh api users/prismalens-labs-agent -q .login                                # → prismalens-labs-agent

# Harness repo renamed + private
gh api repos/Sumit1993/prismalens-agents-harness -q '"\(.name) \(.visibility)"' \
                                                                            # → prismalens-agents-harness PRIVATE

# Local rename
test -d /home/sumit/sources/todo-app/prismalens-agents-harness && echo ok   # → ok
test ! -d /home/sumit/sources/todo-app/todo-app-monorepo && echo ok         # → ok

# apps/ and packages/ STILL EXIST (stripped at end of Phase 3)
cd /home/sumit/sources/todo-app/prismalens-agents-harness
test -d apps && test -d packages && echo ok                                 # → ok

# New scaffolding exists, SPEC.md relocated to internal-docs/
test -f internal-docs/personas.md && \
test -f internal-docs/SPEC-v1-archive.md && \
test -f internal-docs/SPEC.md && \
test ! -f SPEC.md && \
test -f tools/personas.json && \
test -f tools/README.md && \
test -f scenarios/README.md && \
test -f harness/env-config.yaml && echo ok                                  # → ok

# Workspace file updated
grep -q 'prismalens-agents-harness' /home/sumit/sources/todo-app/todo-app.code-workspace && \
! grep -q 'todo-app-monorepo' /home/sumit/sources/todo-app/todo-app.code-workspace && echo ok
                                                                            # → ok

# Clean tree, pushed
git status --porcelain                                                      # → empty
git rev-list --count origin/main..HEAD                                      # → 0
```

If all return as expected, Phase 1 is done.

## Idempotency notes

- Tasks 1.1, 1.2 (web-based account creation): not idempotent. Skip if already done.
- Task 1.3, 1.4, 1.5, 1.6: safe to rerun (idempotent via overwrite).
- Tasks 1.8, 1.9, 1.10: not idempotent — wrap in existence checks.
- Task 1.12: idempotent — push of nothing is a no-op.

## Escalation triggers

- Org name `prismalens-labs` is taken — needs new name decision (unlikely given verification).
- Bot account signup blocked (gmail-alias rejected, etc.) — try a different alias.
- `gh repo rename` fails with permission error — needs `repo` scope refresh.
- Local path collision: `/home/sumit/sources/todo-app/prismalens-agents-harness` already exists — investigate (probably a partial earlier run).
