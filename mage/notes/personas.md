---
type: reference
tags: [todo-app/product]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Personas

Four persona identities used consistently across `prismalens-labs/*` repos. Three are synthetic; one is the real maintainer.

| Key | Name | Email | Type | Repos |
|---|---|---|---|---|
| `arjun` | Arjun Menon | `arjun.menon@labs.prismalens.io` | Synthetic | `todo-api` |
| `priya` | Priya Shah | `priya.shah@labs.prismalens.io` | Synthetic | `todo-web` |
| `sre` | SRE | `sre@labs.prismalens.io` | Synthetic | `infra-k8s`, `infra-docker`, `platform-runbooks` |
| `sumit` | Sumit Patel | maintainer's real Sumit1993 GitHub-noreply email | Real | None — admin/founder; opens GitHub Issues, never commits |

## Cover story

`prismalens-labs` is a sandbox namespace under PrismaLens hosting experimental services. `todo-api` and `todo-web` are the first apps in residence, maintained by a small team. Sumit (the real maintainer) is the founder of PrismaLens and admins the labs org; arjun/priya/sre are engineers on the team. The `@labs.prismalens.io` subdomain is a deliberate test signal — the realism goal is "credible small team running experiments under prismalens", not "fake company you believe is real".

## How to apply a persona to a local clone

After cloning a `prismalens-labs/*` repo:

```bash
cd <repo>
git config user.name "Arjun Menon"
git config user.email "arjun.menon@labs.prismalens.io"
```

(Local config — no `--global`.) The synthetic-history generator in `tools/gen-history.ts` reads the same identities from `tools/personas.json`.

## What the agent sees vs what the maintainer sees

| Surface | Seen by agent | Seen by maintainer |
|---|---|---|
| `git log` in `prismalens-labs/todo-api` | arjun's commits | same |
| `git log` in `prismalens-labs/todo-web` | priya's commits | same |
| `gh issue list -R prismalens-labs/todo-api` | issues authored by Sumit1993 | same |
| This file (`internal-docs/personas.md`) | NEVER (private harness) | always |
| `tools/personas.json` | NEVER (private harness) | always |

## Adding a persona (for future extensions)

When adding a new service via the extension recipe (e.g., a Python worker), add a new persona row above, a new entry in `tools/personas.json`, and assign the persona to the new repo's `repos` column. The persona's email follows the `<name>@labs.prismalens.io` pattern.
