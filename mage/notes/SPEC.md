---
type: spec
tags: [todo-app/core]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

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

## Getting started

You are a coding assistant helping the maintainer build and operate this harness. The PrismaLens agent under test never reads this repo.

- **Executing the plan from scratch:** start at [`phase-1-spec.md`](phase-1-spec.md). Each phase spec lists preconditions (verifiable via shell commands) and a Definition-of-Done block. Run phases in order: 1 → 2 → 3 → 4.
- **Extending the system (add a service / topology / scenario):** see [`extension-recipes.md`](extension-recipes.md).
- **Understanding why decisions were made:** see [`decision-register.md`](decision-register.md).
- **Architecture deep-dive:** [`TEST-ENV-PLAN.md`](TEST-ENV-PLAN.md).
- **Phase status:** if a phase's DoD checks pass, it's done. There is no separate progress file — filesystem state is the source of truth.

## Where to find more

- [`TEST-ENV-PLAN.md`](TEST-ENV-PLAN.md) — full architecture and phasing
- [`personas.md`](personas.md) — persona identities
- [`eval-contract.md`](eval-contract.md) — JSON contract for the eval framework
- [`agent-workflow.md`](agent-workflow.md) — agent contribution + cleanup workflow
- [`latent-bugs.md`](latent-bugs.md) — Bug A / Bug B reference (maintainer only)
- [`branch-protection.md`](branch-protection.md) — protection ruleset
- [`extension-recipes.md`](extension-recipes.md) — how to add services / topologies / scenarios
- [`roadmap.md`](roadmap.md) — planned future extensions
- [`decision-register.md`](decision-register.md) — Q1-Q12 decisions
- [`SPEC-v1-archive.md`](SPEC-v1-archive.md) — pre-rewrite snapshot of the original SPEC.md

---

> Some files referenced from later specs (e.g., `general-investigation.md`, `docs/incidents/*.md`) are deliverables created by Phase 3 and 4 themselves — they don't exist in this repo until those phases execute. This is by design.
