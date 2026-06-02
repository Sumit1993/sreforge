---
type: plan
tags: [todo-app/test-env]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Test Environment Rearchitecture Plan

> Strategic plan to rebuild this evaluation environment as a realistic polyrepo "labs" namespace with one scripted incident and two latent bugs. Designed as an eval fixture for the PrismaLens AI investigation agent under development at [`prismalens/prismalens-agents`](https://github.com/prismalens/prismalens-agents).

## Context

This workspace was originally scaffolded as a monorepo plus a set of extracted precursor repos (`todo-app-api`, `todo-app-ui`, `todo-app-ops`). The intent is to build a realistic-feeling product environment plus an incident-injection harness, used as an eval target by the PrismaLens agent.

Three structural problems made the original shape unfit:

1. **The monorepo leaked the simulation.** A single tree containing both `apps/api` and `scripts/orchestrate.sh` betrays that this is staged. The harness layer must be cleanly separated from the agent-visible target.
2. **The precursor repos had giveaway history.** Commits like `Phase 0`, `Initial commit from create-turbo`, `checkpoint: pre-WSL migration` are dead-giveaway tells.
3. **Breadth before depth.** 7 service stubs and 5 deployment topologies were scoped before a single end-to-end injection-and-recovery scenario had run.

This plan replaces the polyrepo decomposition described in the original `SPEC.md` (preserved at `internal-docs/SPEC-v1-archive.md`).

## Threat model

The agent under test is a CLI/IDE-style coding agent (PrismaLens, Claude Code, Codex, Copilot, etc.). The maintainer grants it bounded access; its effectiveness scales with the access granted. Concretely:

- **Read access**: clones of agent-visible repos under `prismalens-labs/*`, fetched via HTTPS or pre-cloned into a sandbox.
- **GitHub API access**: scoped fine-grained PAT for `prismalens-labs/*`. Can read issues, PRs, code, history. CANNOT enumerate other orgs. CANNOT access the private harness.
- **Service access**: HTTPS to Prometheus, Alertmanager, Grafana, Loki, the API, the DB (via env-var credentials).
- **Commit access**: ONLY via PR from a fork. Direct push to `prismalens-labs/*/main` is blocked by branch protection. The agent's recommended fix is opened as a PR, validated as a test, then discarded without a trace (per fixture lifecycle below).

The agent will recognize that it's in a labs/eval namespace from the first `git log` (persona emails are at `@labs.prismalens.io`). The eval does NOT depend on the agent believing the env is real production — it depends on the agent's ability to investigate using realistic artifacts.

## Realism discipline

- **Public-facing artifacts read as competent small-team product docs.** Repo READMEs, runbooks, in-repo incident notes, PRs, commit messages, inline code comments don't reference "testing", "simulation", "harness", "scenario", "injection", "evaluation".
- **The only place that names what this is for** is `internal-docs/` inside the private harness repo. Cover story everywhere else: *"prismalens-labs is a sandbox namespace under PrismaLens hosting experimental services. todo-api and todo-web are the first apps in residence, maintained by a small team."*
- **Service voice**: code reads as a competent team's work-in-progress. Mix of finished modules and "TODO: refactor" comments. Three pre-existing latent bugs (closure-captured cache, timeout mismatch, retry-on-validation-error) survive into the seeded repos as believable accumulated technical debt. Their `BUG #` annotation comments are stripped at extraction time.
- **People voice**: commit messages, PR descriptions, runbook prose written as humans write — terse, occasionally imperfect grammar, lowercase types (`fix:`, `feat:`, `chore:`).

## Target architecture

### Three GitHub spaces, strictly separated

```
GitHub org: prismalens-labs                       (PUBLIC, agent-visible)
├── todo-api                  NestJS API
├── todo-web                  Next.js UI
├── infra-k8s                 Helm + Prometheus rules + Grafana dashboards (parked, v2)
├── infra-docker              Docker Compose staging (active v1 topology)
└── platform-runbooks         SRE runbooks referenced from alerts

GitHub user: prismalens-labs-agent                (PUBLIC, machine user)
├── todo-api                  Fork. Holds agent-attempt/<run-id> branches.
└── todo-web                  Fork (created lazily when first frontend bug is tested).

Personal account: Sumit1993                       (PRIVATE, admin-only)
└── prismalens-agents-harness This repo, renamed. Contains:
                              - scripts/{setup,teardown,status}.sh (dispatchers)
                              - scripts/scenarios/<id>/{setup,teardown,verify}.sh
                              - scripts/lib/{load-generator,cleanup-fork,extract}.{sh,ts}
                              - scenarios/*.yaml
                              - tools/gen-history.ts, tools/personas.json
                              - tools/messages/{backend,frontend,infra}.txt
                              - harness/env-config.yaml
                              - internal-docs/*
                              The agent never sees this repo or any URL pointing at it.
```

`prismalens-labs/infra-kamal` is deferred to v3. Firebase, Supabase, multi-language services are likewise deferred to v2+ per the Extension model below.

### Committer identities (four personas)

| Key | Name | Email | Repos |
|---|---|---|---|
| arjun | Arjun Menon | `arjun.menon@labs.prismalens.io` | `todo-api` |
| priya | Priya Shah | `priya.shah@labs.prismalens.io` | `todo-web` |
| sre | SRE | `sre@labs.prismalens.io` | `infra-k8s`, `infra-docker`, `platform-runbooks` |
| sumit | Sumit Patel | (real `Sumit1993` GitHub-noreply email) | none — admin/founder, opens issues only |

The first three are synthetic — used by `gen-history.ts` for seeded commits, and by any future real commits (operator sets `git config user.email` per cloned repo). The fourth is the maintainer; real GitHub user, owns the orgs and opens admin issues. The `@labs.prismalens.io` subdomain is a deliberate test signal — not an attempt at cover.

### Topology for v1: Docker Compose

Single Compose stack on the maintainer's local machine (or any Docker host). K8s, Kamal, Firebase, Supabase deferred to v2+ per Extension model. The value being validated in v1 is end-to-end fixture-lifecycle + alert-fire mechanics, not topology breadth.

### First scripted scenario: `latency-retry-storm`

A burst of malformed `DELETE /todos/<non-int>` requests reaches a controller with no `ParseIntPipe`. Prisma raises a validation error per request. The service-layer `withRetry` wrapper retries each error 3× with exponential backoff regardless of error class. Effective DB load is 3× incoming; cumulative backoff latency pushes p99 above the 2s alert threshold within minutes.

- **Symptom**: Prometheus alert `TodoApiLatencyP99High` fires (p99 > 2s sustained 5 min). Secondary alert `TodoApiDeleteErrorRateHigh` fires faster.
- **Trigger**: harness `setup.sh` runs `scripts/lib/load-generator.sh --target "http://localhost:3000/todos/<random>" --method DELETE --rps 50 --duration 600`.
- **Agent-visible artifacts**:
  - The firing alerts in Alertmanager
  - The runbook at `prismalens-labs/platform-runbooks/general-investigation.md`
  - Loki logs showing repeated Prisma validation errors followed by retry attempts
  - Controller code in `todo-api/src/todos/todos.controller.ts` (missing `ParseIntPipe`)
  - Service code in `todo-api/src/todos/todos.service.ts` (`withRetry` retrying all errors)
- **Acceptance**: `scripts/setup.sh latency-retry-storm` makes the alert fire within the 5-min eval window. `scripts/teardown.sh latency-retry-storm` clears it.
- **Injection mechanism**: pure load — no code change, no migration, no deploy. The bug is in real code; injection is real malformed traffic.

### Latent bugs (two for v1, user-triggered via UI)

Bugs present in the seeded `todo-api` code that surface when an end user does specific things in the UI. No scripted inject — the trigger is the user's action. Symptoms caught by Prometheus alerts. Documented for the maintainer in `internal-docs/latent-bugs.md`; never exposed to the agent.

| Bug | Location | Trigger (UI action) | Symptom | Alert |
|---|---|---|---|---|
| **A — input length unbounded** | `todos/dto/create-todo.dto.ts` lacks `@MaxLength`. Bypassed by controller using `@Body('todo')` instead of binding the DTO. | User pastes very large content (>50KB) into todo input | Slow POST `/todos`, disk pressure | `TodoApiPostTodosLatencyHigh` |
| **B — no `ParseIntPipe` on DELETE** | `todos.controller.ts` `@Delete(':id')` has `id: number` but no pipe; `main.ts` ValidationPipe has `transform: false` | User navigates to `/todos/<non-int>` (typo, autocomplete glitch) | Prisma validation error → 500. Amplified by `withRetry`. | `TodoApiDeleteErrorRateHigh` |

The agent investigating either follows the same surface as scripted scenarios — no harness involvement, no special signaling.

### Scenario authoring principles (apply to all scenarios)

1. **Deploys go through the project's real tooling.** No side-channel SQL, no manual `kubectl edit`. If a scenario mutates DB schema, it uses Prisma. If it mutates K8s state, it uses `helm` or `kubectl apply`. The bug is in code/config; injection is real state mutation observable via standard tools.
2. **Reset produces real revert artifacts.** Revert commits, restore migrations, rolled-back Helm releases — observable from the same investigation tools the agent uses. No history rewrites mid-cycle.
3. **Every inject writes a deploy receipt.** `setup.sh` writes `$HARNESS_STATE/deploys/<scenario>/<run-id>.json` with `{commit_sha, deployed_at, topology, alert_fired_at}` for eval-framework correlation.

For `latency-retry-storm`: principle 1 is satisfied trivially (no deploy). Principles 2/3 apply lightly. Future scenarios involving migrations/deploys exercise all three fully.

### Agent contribution model

The agent contributes only via PR from a fork (`prismalens-labs-agent/<repo>` → `prismalens-labs/<repo>`). Direct push to `prismalens-labs/*/main` is blocked by branch protection (admin Sumit can bypass for inject scenarios; agent cannot).

**Cleanup contract** — every successful test run, teardown:

1. Closes the PR (`gh pr close --delete-branch`) — fork branch goes away
2. Deletes the upstream PR record via GraphQL mutation — closed PR no longer visible in upstream's PR list
3. Every Nth run (default N=10), wipes and recreates the entire fork

Detail in `internal-docs/agent-workflow.md`.

### Fixture lifecycle (three layers)

| Layer | Frequency | What |
|---|---|---|
| **Stack** | Once per workstation, stays up | `docker compose up -d` |
| **Setup** | Per eval run | `scripts/setup.sh <scenario-id>` — reset DB to seed, ensure baseline deployed, run scenario-specific inject, write deploy receipt, emit JSON contract on stdout |
| **Teardown** | Per eval run **on success** | `scripts/teardown.sh <scenario-id>` — stop load, reset DB to seed, run agent-PR cleanup |

On test failure, the eval framework skips teardown to allow post-mortem. Manual teardown is the recovery path.

JSON contract documented in `internal-docs/eval-contract.md`. Per-deployment configuration in `harness/env-config.yaml`, read at setup time.

## Extension model

The architecture supports three independent extension axes. v1 exercises a thin slice; the rest is plug-and-play.

| Axis | v1 ships | v2+ extension recipe (see `internal-docs/extension-recipes.md`) |
|---|---|---|
| **Service (language/runtime)** | NestJS API + Next.js UI | New repo `prismalens-labs/<service>`. New persona in `tools/personas.json`. `gen-history.ts` run with new corpus. Add as compose service. |
| **Topology (deploy target)** | Docker Compose | New repo `prismalens-labs/infra-<topology>` (k8s, kamal, firebase, supabase, ...). Refactor `scripts/setup.sh` to dispatch per-topology when the second topology lands. |
| **Scenario (incident class)** | `latency-retry-storm` (scripted) + bugs A and B (latent) | New `scripts/scenarios/<id>/` with setup/teardown/verify. Optional scenario YAML. Optional new Prometheus alert. |

Forward queue lives in `internal-docs/roadmap.md`.

## What we keep, what we throw away

| Artifact | Disposition |
|---|---|
| This monorepo (`todo-app-monorepo`) | **RENAME** to `prismalens-agents-harness`. Make private. `apps/`/`packages/` strip happens at end of Phase 3. |
| `apps/api` | **SEED** content for `prismalens-labs/todo-api`. Discard git history. |
| `apps/ui` | **SEED** content for `prismalens-labs/todo-web`. Discard git history. |
| `apps/api-{python,java,go,firebase,supabase}` (stubs) | **DELETE** at end of Phase 3 (no extraction). Future languages get scaffolded fresh per extension recipe. |
| `packages/core` (Zod schemas) | **INLINE** into `prismalens-labs/todo-api` as `src/core/`. |
| `packages/db` (Prisma) | **INLINE** into `prismalens-labs/todo-api` as `prisma/`. |
| `infra/helm/*` | **SEED** content for `prismalens-labs/infra-k8s`. Parked for v2. |
| `infra/docker/dev/docker-compose.yml` | **SEED** content for `prismalens-labs/infra-docker` (extended into full staging stack in Phase 4). |
| `infra/prometheus/` | **SEED** content for `prismalens-labs/infra-docker/prometheus/`. New alerts (`TodoApiLatencyP99High`, `TodoApiPostTodosLatencyHigh`, `TodoApiDeleteErrorRateHigh`) added in Phase 4. |
| `SPEC.md` (was at repo root) | **MOVE + REWRITE** to `internal-docs/SPEC.md`. Original preserved at `internal-docs/SPEC-v1-archive.md`. Root `SPEC.md` deleted. |
| Pre-existing intentional `BUG #` / `FIXME` / `XXX` / `HACK` annotations in code | **STRIP** during Phase 3 extraction. Bugs survive; annotations don't. |
| `Sumit1993/todo-app-{api,ui,ops}` precursor repos (GitHub) | **DELETE / ARCHIVE** after content is seeded into `prismalens-labs/*`. |
| WSL clones at `/home/sumit/sources/todo-app/todo-app-{api,ui,ops}/` | **DELETE** after content seeds new repos. |
| Legacy `nestjs-app` / `nextjs-app` GitHub redirects | **DROP** when source repos are archived. |

## Phase plan

Detail per phase lives in `internal-docs/phase-{1,2,3,4}-spec.md`.

### Phase 0 — Decisions to lock

Done — Q1 through Q12 grilling complete. Decision register at `internal-docs/decision-register.md`.

### Phase 1 — GitHub org + harness rename (½ day)

- Create GitHub org `prismalens-labs` (free tier)
- Create machine user `prismalens-labs-agent`
- Document personas in `internal-docs/personas.md` + `tools/personas.json`
- Snapshot original `SPEC.md` to `internal-docs/SPEC-v1-archive.md`
- Create scaffolding directories (`scenarios/`, `tools/`, `harness/`)
- Write new `internal-docs/SPEC.md` (relocated from repo root) and delete root `SPEC.md`
- Rename this repo to `prismalens-agents-harness`, make private

**Phase 1 does NOT strip `apps/` or `packages/`** — that moves to end of Phase 3, after content has been extracted.

### Phase 2 — Synthetic history generator (1-2 days)

Build `tools/gen-history.ts` + message corpora + vitest tests. See `phase-2-spec.md`.

### Phase 3 — Seed `prismalens-labs/*` repos (1-2 days)

1. Create four agent-visible repos + the agent bot's forks
2. Extract `apps/api` → `prismalens-labs/todo-api` (with `packages/core` + `packages/db` inlined). **Strip `BUG #`/`FIXME`/`XXX`/`HACK` whole-line annotations during extraction.**
3. Extract `apps/ui` → `prismalens-labs/todo-web`
4. Seed `prismalens-labs/infra-k8s` from `infra/helm/` and `infra/prometheus/` (parked for v2)
5. Seed `prismalens-labs/platform-runbooks` (hand-authored real runbook content, including `general-investigation.md`)
6. Run `gen-history.ts` against each repo: arjun×90 / priya×50 / sre×30 / sre×20 commits respectively
7. Open small number (1-3) of issues per repo as `Sumit1993` (C+D model)
8. Add `docs/incidents/*.md` to each repo for additional realism (mostly by `sre` persona via gen-history)
9. Apply branch protection rules to each repo's `main`
10. Strip `apps/` and `packages/` from harness (final cleanup commit)

### Phase 4 — Stand up incident environment (1-2 days)

- Create `prismalens-labs/infra-docker` (active topology)
- Author Docker Compose stack (postgres + valkey + todo-api + todo-web + prometheus + alertmanager + grafana + loki)
- Author Prometheus alerts (`TodoApiLatencyP99High`, `TodoApiPostTodosLatencyHigh`, `TodoApiDeleteErrorRateHigh`)
- Configure Alertmanager webhook receiver (URL env-var driven)
- Author `scripts/setup.sh`, `scripts/teardown.sh`, `scripts/status.sh` (dispatchers)
- Author `scripts/scenarios/latency-retry-storm/{setup,teardown,verify}.sh`
- Author `scripts/lib/{load-generator,cleanup-fork}.sh`
- Author `scenarios/latency-retry-storm.yaml`
- Author `harness/env-config.yaml` (local default)
- Author internal docs (`eval-contract.md`, `agent-workflow.md`, `latent-bugs.md`, `branch-protection.md`)
- Smoke test: setup → alert fires → verify=0 → teardown → alert clears

### Phase 5 — Iterate (ongoing)

Per Extension model. Driven by `internal-docs/roadmap.md`.

## Critical decisions parked for future phases

- **AWS simulation (Floci or LocalStack)** — defer until an AWS-shaped incident is in scope.
- **K8s topology activation** — defer to v2. `infra-k8s` repo exists with synthetic history but no live cluster.
- **Ticketing system (Jira / Linear)** — v1 uses GitHub Issues + `docs/incidents/` markdown. Real Jira integration deferred.
- **Sentry** — add to v1 if free-tier setup is fast, defer otherwise.
- **Multi-VCS** (GitLab, Bitbucket, Gitea) — deferred until cross-VCS scenarios are scoped.
- **Quiet-stretch synthetic-history pattern** — declined for v1; bump if history feels too uniform after first eval runs.

## Files this plan touches

**Created inside `prismalens-agents-harness`:**

- `tools/gen-history.ts` (~200 LOC) + `tools/lib/{scheduler,bucketer,message-picker}.ts` + `tools/__tests__/*.test.ts`
- `tools/personas.json`, `tools/messages/{backend,frontend,infra}.txt`
- `scripts/{setup,teardown,status}.sh` (dispatchers)
- `scripts/scenarios/latency-retry-storm/{setup,teardown,verify}.sh`
- `scripts/lib/{load-generator.sh,cleanup-fork.sh,extract.ts}`
- `scenarios/latency-retry-storm.yaml`
- `harness/env-config.yaml`
- `internal-docs/`: `SPEC.md`, `personas.md`, `SPEC-v1-archive.md`, `eval-contract.md`, `agent-workflow.md`, `latent-bugs.md`, `branch-protection.md`, `extension-recipes.md`, `roadmap.md`, `decision-register.md`

**Created (new GitHub repos under `prismalens-labs`):**

- `prismalens-labs/{todo-api, todo-web, infra-k8s, infra-docker, platform-runbooks}`

**Created (under `prismalens-labs-agent`):**

- Forks of `prismalens-labs/todo-api` and (lazily) `prismalens-labs/todo-web`

**Removed from repo root:**

- `SPEC.md` (content moved to `internal-docs/SPEC.md`; original snapshotted at `internal-docs/SPEC-v1-archive.md`)

**Deleted / archived:**

- `Sumit1993/todo-app-{api,ui,ops}` precursor repos
- WSL clones at `/home/sumit/sources/todo-app/todo-app-{api,ui,ops}/`
- `apps/api-{python,java,go,firebase,supabase}` (stubs) — at Phase 3 strip
- `apps/api`, `apps/ui`, `packages/*` — at Phase 3 strip (after extraction)

## Verification at each phase

- **End of Phase 1**: `gh api orgs/prismalens-labs -q .login` returns `prismalens-labs`. `gh api users/prismalens-labs-agent -q .login` returns the bot. Harness repo private + renamed. `apps/` and `packages/` still exist locally (stripped at end of Phase 3).
- **End of Phase 2**: `pnpm --filter tools tsx gen-history.ts --help` runs. Dry-run produces N synthetic commits.
- **End of Phase 3**: `gh repo list prismalens-labs` shows 4 repos with expected commit counts/personas. Branch protection applied. Forks exist on the bot account. `apps/` and `packages/` no longer in harness.
- **End of Phase 4**: `scripts/setup.sh latency-retry-storm` makes `TodoApiLatencyP99High` fire within 6 min; `scripts/teardown.sh` clears it. JSON contract emitted per `eval-contract.md`.

## Effort estimate

| Phase | Effort |
|---|---|
| 0 | Done |
| 1 | ½ day |
| 2 | 1-2 days |
| 3 | 1-2 days |
| 4 | 1-2 days |
| **Total to consumer-ready env** | **~5 working days** |
| 5+ | weeks to months, driven by extension queue |

## Risks

- **GitHub rate limits during Phase 3** — manageable; volume is low under C+D model.
- **Synthetic history detection** — mitigated by `gen-history.ts` patterns (randomized seconds, weekday biasing, Friday bursts, weekend hotfixes).
- **Realism leak via commit/issue voice** — managed via corpus and people-voice guidelines.
- **Branch protection blocks force-push during seeding** — mitigated by applying protection AFTER history generation completes.
- **The agent recognizes `labs.prismalens.io` as a test signal** — accepted by design; eval signal doesn't depend on the agent being fooled about the env.
