---
type: plan
tags: [todo-app/roadmap]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Roadmap

> Chronological queue of planned extensions to the eval fixture. Each entry should name the driver (what motivates adding it). When an item lands, mark it ✅ and link the PR/commit.

## Done

- ✅ **v1 baseline** (2026-05) — `latency-retry-storm` scripted scenario, Bug A and Bug B latent bugs, Docker Compose topology, NestJS API + Next.js UI services, fixture lifecycle (setup/teardown/status), JSON contract, fork-based PR workflow.

## Near-term (v2)

These unlock the next class of investigation scenarios. Pick from this queue based on what the PrismaLens agent under test most needs to be evaluated against.

- [ ] **K8s topology activation.** Driver: scenarios involving pod lifecycle, OOM-kills, HPA reactions, ConfigMap reloads, deployment rollbacks. Currently `prismalens-labs/infra-k8s` exists with synthetic history but no live cluster. See [extension-recipes.md](extension-recipes.md) Recipe 2.

- [ ] **Python worker service.** Driver: cross-language investigation (the agent must read both TypeScript and Python idioms). New persona, new corpus file, new compose service. See Recipe 1.

- [ ] **Second scripted scenario: `cache-stampede-oom`.** Driver: exercise pre-existing BUG #3 (closure-captured cache). Requires container memory monitoring. See Recipe 3.

- [ ] **Third scripted scenario: `db-connection-pool-exhaustion`.** Driver: classic prod incident class. Inject by saturating connection pool with long-running queries.

- [ ] **GitHub Actions workflow `.github/workflows/agent-pr-validation.yml`** in each `prismalens-labs/*` repo. Driver: required-status-check gate on the agent's PRs. Currently `required_status_checks: null` per branch-protection.md.

## Mid-term (v3)

- [ ] **Kamal VM topology.** Driver: deploy-shaped incidents (failed health checks during rolling update, traefik label misconfiguration).

- [ ] **AWS-shaped incidents via Floci or LocalStack.** Driver: cloud-provider incidents (S3 bucket policy misconfiguration, IAM role boundaries, SQS visibility timeout).

- [ ] **Firebase topology.** Driver: serverless cold-start incidents, Firestore index misconfiguration.

- [ ] **Supabase topology.** Driver: row-level-security misconfiguration scenarios.

## Long-term (v4+)

- [ ] **Multi-VCS support (GitLab, Bitbucket, Gitea).** Driver: agent investigating projects hosted outside GitHub. Likely requires significant harness rework.

- [ ] **Sentry integration.** Driver: error-aggregation surface beyond just Loki logs. Free-tier setup is fast; defer until a scenario needs it.

- [ ] **Real Jira / Linear integration.** Driver: ticket-driven investigations. v1 uses GitHub Issues + `docs/incidents/` markdown as proxy.

- [ ] **Multi-tenant scenarios.** Driver: incidents where one tenant's behavior affects another.

- [ ] **Distributed-trace investigation surface (Tempo / Jaeger).** Driver: incidents that only make sense across service boundaries.

## On-hold / declined

- ❌ **Quiet-stretch synthetic-history pattern.** Declined for v1 (Q12 decision). Revisit if synthetic history feels too uniform after first eval runs.

- ❌ **Per-persona GitHub accounts (machine users for arjun/priya/sre).** Declined for v1 (Q2). The C+D persona model uses `Sumit1993` as the visible org admin without separate accounts.

- ❌ **Long-running harness daemon for continuous baseline load.** Declined for v1 (Q5). The eval framework drives all UI triggers; the harness is a one-shot CLI.

## How to use this file

1. When picking what to build next, prefer items higher in the queue.
2. Each item names a **driver** — if the driver no longer applies, deprecate the item rather than ship it.
3. Adding new items is fine; just slot them by priority and note the driver.
