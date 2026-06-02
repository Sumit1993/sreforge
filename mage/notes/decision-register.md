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

# Decision register — Q1 through Q12 grilling

> Outcomes of the architectural grilling session. Each row names the question, the chosen option, and where the decision is implemented in the spec.

| Q | Branch | Decision | Implemented in |
|---|---|---|---|
| 1 | Threat model | **Hybrid** — agent is a CLI/IDE-style coding agent (PrismaLens, Claude Code, Codex, Copilot). Maintainer-bounded access via fine-grained PAT. Can read agent-visible repos and hit service URLs; cannot enumerate other orgs or access the private harness. | `TEST-ENV-PLAN.md` "Threat model" section |
| 2 | Persona / GitHub author identity | **C+D** — accept `Sumit1993` as the visible org admin and author of all GitHub Issues. Add Sumit as a documented 4th persona (founder/admin, no commits). Most "issue-shaped" artifacts move to `docs/incidents/` markdown committed by personas via `gen-history.ts`. Drop heavy `gen-issues.ts` machinery. | `personas.md`, Phase 3 spec Task 3.2 (minimal `gen-issues.ts`) |
| 3 | Deploy mechanism for scripted scenarios | **A** — Compose `build:` from local checkout (no GHCR dependency), real `prisma migrate deploy` (no side-channel SQL). Plus three **scenario authoring principles**: real tooling, real revert artifacts, deploy receipts. (For `latency-retry-storm` specifically, no deploy is exercised — principles bind on future scenarios.) | `TEST-ENV-PLAN.md` "Scenario authoring principles" section; `phase-4-spec.md` Compose `build:` config |
| 4 | Trigger commit timing | **A** — live timestamp on any trigger commit (whenever inject runs). Consumer manages the wait between alert fire and agent invocation. No harness-side waiting loop. | `phase-4-spec.md` setup.sh exits immediately after starting load |
| 5 | Latent bugs | **Bug A (input length unbounded on POST /todos)** and **Bug B (no ParseIntPipe on DELETE /todos/:id, amplified by retry-all)**. Both verified against current code. Trigger is end-user UI action; no scripted inject; no reset. Documented in `latent-bugs.md` for the maintainer only. | `latent-bugs.md`; `phase-4-spec.md` Prometheus rules `TodoApiPostTodosLatencyHigh` + `TodoApiDeleteErrorRateHigh` |
| 6 | Agent contribution surface | **A2** — agent works on a **repo fork** (`prismalens-labs-agent/<repo>`) and opens PRs upstream. Branch protection on upstream `main`. The agent never has admin scope. | `agent-workflow.md`; `phase-1-spec.md` Task 1.2 (bot account); `phase-3-spec.md` Task 3.8 (fork creation) |
| 7 | Fixture lifecycle | **3-layer**: stack (compose up, once) / setup (`scripts/setup.sh <id>`, per-run) / teardown (`scripts/teardown.sh <id>`, per-run **on success**). DB reset via DROP DATABASE + CREATE + reseed by default (`--hard` flag for `down -v`). Cleanup ops 1+2 per teardown (close PR + delete fork branch + delete upstream PR via GraphQL); op 3 every 10th run (full fork wipe + recreate). Minimal JSON contract emitted by setup.sh. `harness/env-config.yaml` parameterizes URLs/ports per deployment. | `eval-contract.md`, `agent-workflow.md`, `phase-4-spec.md` setup/teardown/cleanup scripts |
| 8 | Extraction sequence (Phase 1 vs Phase 3) | **A** — defer the `apps/`/`packages/` strip from Phase 1 to end of Phase 3. Extraction reads directly from the harness's current working tree (no `git show` archeology, no `/mnt/e/` fallback). Path fixup pass across all specs. | `phase-1-spec.md` (no Task 1.4 strip), `phase-3-spec.md` Task 3.10 (strip after extraction) |
| 9+10 | Naming (subdomain, org, harness) | **`prismalens-labs`** org, **`labs.prismalens.io`** persona email subdomain, **`prismalens-labs-agent`** bot account, **`prismalens-agents-harness`** private repo. Env var renamed to `PRISMALENS_LABS_AGENT_PAT`. Old `todo-corp*` names dropped from all specs. | `TEST-ENV-PLAN.md` "Three GitHub spaces" + "Committer identities"; all phase specs use new names |
| 11 | Bug verification + scenario revision | **F2 + C1**: replace `latency-missing-index` (which doesn't work — `findMany` has no `userId` filter in the code) with `latency-retry-storm` (Bug B amplified by pre-existing retry-all). Strip `BUG #` / `FIXME` / `XXX` / `HACK` whole-line dev annotations from code files during Phase 3 extraction (preserved in markdown). SecurityMiddleware verified — no auth blocker, no rate-limit blocker in staging. | `phase-4-spec.md` (entire scenario rewrite); `phase-3-spec.md` Task 3.1 (`extract.ts` with annotation strip); `latent-bugs.md` pre-existing-bugs section |
| 12A | Branch protection ruleset + timing | **Apply at end of Phase 3**, after force-push of synthetic history. Required PR + 1 approving review + restricted users (Sumit1993 only) + admin bypass enabled + force-push/deletion disabled. | `branch-protection.md`; `phase-3-spec.md` Task 3.11 |
| 12B | Commit volume realism | **Keep at 90 / 50 / 30 / 20** (todo-api / todo-web / infra-k8s / platform-runbooks) — generator automates so volume is a one-flag change. Decline quiet-stretch enhancement for v1 (revisit if uniform-feel becomes a problem post-deploy). | `phase-3-spec.md` (unchanged from original counts) |
| 12C | Stub cleanup + extension vision | Strip stubs in Phase 3 final commit (no parking). Document the **extension model** as a first-class concept: three orthogonal axes (service / topology / scenario). Maintain `roadmap.md` + `extension-recipes.md`. | `TEST-ENV-PLAN.md` "Extension model" section; `extension-recipes.md`; `roadmap.md` |

## Note on this register

This document records the **decisions** that were made, not the rationale. The rationale lives in the grilling-session transcript (which is not preserved in the repo).

If a future decision contradicts one of these, update the relevant row and add a `superseded_by:` link to the new decision.
