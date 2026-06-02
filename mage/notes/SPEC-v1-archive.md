---
type: spec
tags: [todo-app/core]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: superseded
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

> Archived snapshot of the original SPEC.md before the Phase 1 rewrite (see TEST-ENV-PLAN.md).

# Todo App Platform -- Comprehensive Specification

> A multi-topology, multi-language, multi-VCS deployment testing ground for AI agent issue detection and resolution.

## 1. Objective

Build a comprehensive deployment environment where an AI agent can:
- **Detect** production issues across diverse infrastructure (K8s, Docker, VMs, Serverless)
- **Diagnose** bugs in 4 programming languages (TypeScript, Python, Java, Go)
- **Resolve** issues using monitoring data from Prometheus, Grafana, Sentry, Elasticsearch, Slack
- **Navigate** multiple VCS platforms (GitHub, GitLab, Bitbucket) and CI/CD pipelines

The app itself is a simple Todo CRUD API -- the complexity is in the infrastructure, not the business logic.

## 2. Non-Goals

- Production-grade high availability (this is a testing ground, not a real product)
- Paid services (all platforms must have free tiers)
- Performance optimization of the app itself (bugs are intentional)

---

## 3. Current State

### Service Repos (AI agent-visible)

| Repo | Stack | Status |
|------|-------|--------|
| `todo-app-api-nestjs` | NestJS 11, Node 20, PostgreSQL 16, Valkey 8 | Working (local) — being extracted from monorepo |
| `todo-app-ui` | Next.js 15, React 19 | Working (local) — being extracted from monorepo |
| `todo-app-api-python` | FastAPI, Python 3.12 | Pending |
| `todo-app-api-go` | Gin, Go 1.22 | Pending |
| `todo-app-api-java` | Spring Boot 3, Java 21 | Pending |

### Ops Repos (AI agent-visible)

| Repo | Contents | Status |
|------|----------|--------|
| `todo-app-ops-k8s` | Helm charts, Gateway API manifests, runbooks | Being extracted from monorepo |
| `todo-app-ops-docker` | Docker Compose configs, runbooks | Being extracted from monorepo |
| `todo-app-ops-vm` | Kamal v2 deploy configs, runbooks | Being extracted from monorepo |

### Shared Packages

| Package | Registry | Status |
|---------|----------|--------|
| `@todo-app/core` | GitHub Packages (npm) | Being extracted — Zod schemas, ports/adapters interfaces, env validation |

### Orchestrator (PRIVATE — admin only)

| Component | Contents | Status |
|-----------|----------|--------|
| `todo-app-monorepo` (this repo) | Issue injection system, orchestration scripts, scenario definitions | Active |

### What is working today
- NestJS API with real PostgreSQL (Prisma 7, adapter-pg) and Valkey cache (ioredis)
- Hexagonal architecture: `@todo-app/core` defines ports (ITodoRepository, ICacheProvider, ILogger), API provides adapters
- 7 intentionally planted code-level bugs: validation gap, correlation ID loss, cache TTL, closure capture, timeout mismatch, aggressive retry, rate limiter race
- Local Prometheus + Alertmanager with 6 alert rules
- Helm charts for local K8s (Rancher Desktop)
- VCS: GitHub only (GitLab + Bitbucket mirroring planned for Phase 8)

---

## 4. Target State

### 4.1 Repository Architecture: Polyrepo Model

The platform uses a **polyrepo model**. Each service and ops surface is an independent GitHub
repository that looks like it belongs to a real engineering team. A private orchestrator repo
(never visible to the AI agent) controls the simulation.

```
# ── What the AI agent can access ──────────────────────────────────────────────

github.com/todo-corp/todo-app-api-nestjs      TypeScript    NestJS 11       port 3000
github.com/todo-corp/todo-app-api-python      Python        FastAPI         port 8000
github.com/todo-corp/todo-app-api-java        Java          Spring Boot     port 8080
github.com/todo-corp/todo-app-api-go          Go            Gin             port 8081
github.com/todo-corp/todo-app-ui              TypeScript    Next.js 15      port 3001

github.com/todo-corp/todo-app-ops-k8s         SRE-owned     Helm charts, Gateway API, runbooks
github.com/todo-corp/todo-app-ops-docker      SRE-owned     Docker Compose, runbooks
github.com/todo-corp/todo-app-ops-vm          SRE-owned     Kamal v2 configs, runbooks

npm: @todo-app/core (GitHub Packages)         Shared        Zod schemas, ports/adapters interfaces

# ── What only the admin sees (PRIVATE — never exposed to AI agent) ────────────

github.com/[admin]/todo-app-monorepo          Orchestrator  Issue injection, scenario definitions,
                                                            orchestration scripts (this repo)
```

#### Per-repo structure

Each **service repo** (`todo-app-api-nestjs`, `todo-app-ui`, etc.) contains:
```
<service>/
  src/              Application code
  prisma/           (API only) Schema + migrations
  Dockerfile        Multi-stage build
  .env.example      Service-specific env vars only
  .github/
    workflows/      CI: build, test, docker push to GHCR
  README.md         Realistic team-facing docs (no simulation references)
```

Each **ops repo** (`todo-app-ops-k8s`, etc.) contains:
```
<ops-repo>/
  helm/             (k8s only) Helm charts: api, ui, postgresql, valkey, umbrella
  docker/           (docker only) docker-compose.yml + overrides
  kamal/            (vm only) deploy.yml per language
  docs/
    runbooks/       On-call runbooks — these are linked from Prometheus alerts
                    (the AI agent's entry point into the ops repo)
  README.md         Realistic SRE-facing docs
```

The **orchestrator** (`todo-app-monorepo`, private) contains:
```
todo-app-monorepo/
  infra/
    issues/         67 issue injection scenario YAMLs
    prometheus/     Prometheus + Alertmanager configs (admin monitoring)
    dagger/         Optional: portable CI/CD pipelines
  scripts/
    orchestrate.sh  Main admin CLI (inject, validate, reset, status)
    clone-workspace.sh  Git clone all repos into workspace/
  workspace/        (gitignored) Live git clones of all service + ops repos
  SPEC.md           This document
```

#### Serverless adapters (future)
```
github.com/todo-corp/todo-app-firebase-api    TypeScript    Cloud Functions
github.com/todo-corp/todo-app-supabase-api    TypeScript    Deno Edge Functions
```

### 4.2 Deployment Topologies

| # | Topology | What It Replicates | Where |
|---|----------|-------------------|-------|
| 1 | **Kubernetes** | AWS EKS / GCP GKE / Azure AKS | OCI OKE (free) + Rancher Desktop (local) |
| 2 | **Docker Compose** | Small team / startup on a single server | Local |
| 3 | **VM (Kamal)** | Traditional bare-metal / cloud VM | OCI Free ARM VM via Kamal |
| 4 | **Serverless** | Firebase Functions + Supabase Edge | Firebase (free) + Supabase (free) |
| 5 | **PaaS** (existing) | Quick-deploy platforms | Render + Vercel (keep as baseline) |

### 4.3 API Services (4 Languages)

All implement the **same contract**:

```
GET    /api/todos           -> { todos: Todo[] }
POST   /api/todos           -> Todo
PATCH  /api/todos/:id       -> Todo
DELETE /api/todos/:id       -> Todo
GET    /api/health          -> { status, timestamp, uptime, memory }
GET    /api/metrics          -> Prometheus text format
```

| App | Language | Framework | Planted Bugs |
|-----|----------|-----------|-------------|
| `api` | TypeScript | NestJS 11 | 7: validation gap, correlation loss, cache TTL, closure capture, timeout mismatch, aggressive retry, rate limiter race |
| `api-python` | Python | FastAPI | 5: blocking `requests` in async, unclosed httpx client, thread-unsafe dict, Pydantic coercion gap, background task crash |
| `api-java` | Java | Spring Boot | 6: RestTemplate per-request (FD leak), unclosed InputStream, HashMap ConcurrentModification, exposed actuator, GC pressure, classpath collision |
| `api-go` | Go | Gin | 5: goroutine leak, channel deadlock, nil resp.Body defer, data race on map, error wrapping `%s` vs `%w` |

### 4.4 Monitoring & Observability

| Tool | Free Tier | Role |
|------|-----------|------|
| **Grafana Cloud** | 10K metrics, 50GB logs, 3 users | Central dashboards + Loki logs |
| **Prometheus** | Self-hosted | Metrics scraping (K8s, Docker, VM) |
| **Alertmanager** | Self-hosted | Alert routing to Slack + webhooks |
| **Sentry** | 5K errors, 10K txns/mo | Error tracking with platform/language tags |
| **Elasticsearch + Kibana** | Self-hosted (Docker) | Log aggregation and search |
| **Slack** | Free workspace | Alert notifications (#critical, #monitoring) |

Metrics flow per topology:

| Topology | Metrics | Logs |
|----------|---------|------|
| K8s | ServiceMonitor -> Prometheus -> remote_write -> Grafana Cloud | Promtail -> Loki |
| Docker | Prometheus scrape via Docker network | Winston Loki transport |
| VM | Prometheus scrape localhost + node_exporter | Winston Loki + file logs |
| Serverless | Push to Grafana Cloud | Winston Loki transport |

### 4.5 Multi-VCS Strategy

GitHub as source of truth, push-mirrored to GitLab + Bitbucket. Each VCS deploys to different targets:

| VCS | CI/CD | Free Minutes | Deploys To |
|-----|-------|-------------|-----------|
| GitHub | Actions | 2000/mo | K8s (OCI), Firebase, Render |
| GitLab | GitLab CI | 400/mo | Docker registry, VM |
| Bitbucket | Pipelines | 50/mo | Supabase, Cloudflare |

### 4.6 Issue Injection System

67 scenarios across 13 categories. Not just code bugs -- **infrastructure, deployment mechanisms, container behavior, language-specific runtime failures, and cross-service issues** that generate real alerts.

| Category | Count | Examples |
|----------|-------|---------|
| Infrastructure (K8s) | 9 | OOMKilled, CrashLoopBackOff, ImagePullBackOff, NetworkPolicy block, DNS failure, disk pressure, bad HPA, node not ready, resource quota |
| Application (code) | 4 | Memory leak, connection pool exhaustion, unhandled rejection, event loop blocking |
| Configuration | 5 | Missing env var, wrong DB string, bad CORS, TLS cert expiry, wrong API URL |
| Database | 4 | Slow query (missing index), pool full, replication lag, migration failure |
| Deployment | 3 | Bad image tag, failed migration rollback, canary with high error rate |
| Security | 4 | Exposed debug endpoint, missing rate limit, SQL injection, API key in logs |
| Cross-Service | 4 | Timeout mismatch, cache invalidation race, correlation ID break, circuit breaker stuck |
| **Build-Time** | **4** | npm platform mismatch, pip ARM failure, Maven timeout, CGO cross-compile |
| **Container-Time** | **6** | JVM ignores cgroup limits, Python worker explosion, GOMAXPROCS host CPUs, Node heap > limit, scratch no shell, distroless no curl |
| **Startup-Time** | **4** | JVM exceeds readiness probe, Prisma migration blocks pod, Python slow imports, Go starts before DB |
| **Runtime (lang x topo)** | **8** | PM2 cache split, gunicorn prefork memory, GC cascade, goroutine leak OOM, event loop block, GIL contention, Hibernate pool leak, missing context cancel |
| **Migration/Deploy** | **6** | Prisma drift, Alembic conflict, Flyway checksum, goose ordering, Helm values mismatch, Docker layer cache stale |

Each scenario is a YAML file specifying: injection steps, expected alerts, observable symptoms, resolution steps, and cleanup.

Tooling:
- `injector.sh inject <scenario-id> --topology k8s` -- inject the issue
- `validator.sh check <scenario-id> --check-resolution` -- validate fix
- `patches/` -- pre-built code patches per language
- `manifests/` -- K8s manifest overrides

---

## 5. Agent Simulation Model

This section describes the full experience the AI agent goes through. It exists only in
this private orchestrator repo — service and ops repos contain no simulation references.

### 5.1 How the Agent Receives a Task

The agent is given a Prometheus/Grafana alert. The alert fires in the monitoring stack and
contains a `runbookUrl` pointing to the relevant ops repo:

```
Alert: PodOOMKilled
Severity: critical
Labels:  pod="todo-app-api-nestjs-xxx", namespace="todo-app"
runbookUrl: https://github.com/todo-corp/todo-app-ops-k8s/blob/main/docs/runbooks/pod-oom-kill.md
```

The agent has access to:
- GitHub repos in the `todo-corp` org (service + ops repos only)
- Prometheus/Grafana metrics API
- kubectl (read-only or scoped)
- Standard shell tools

The agent does **not** have access to:
- This orchestrator repo
- Any `injector.sh` or scenario YAML files
- The `SPEC.md` document

### 5.2 Typical Agent Workflow

```
1. ALERT FIRES
   Prometheus alert fires (injected by orchestrate.sh)
   Alert payload contains runbookUrl → todo-app-ops-k8s/docs/runbooks/<issue>.md

2. AGENT READS RUNBOOK
   Agent fetches the runbook from the ops repo
   Runbook says: "Check memory limits in helm/api-nestjs/values.yaml"
   Runbook links to the service repo for context on expected memory usage

3. AGENT INVESTIGATES
   Agent clones / browses todo-app-ops-k8s
   Finds a recent commit: "chore: right-size API memory to reduce cloud costs"
   Sees memory limit changed to 32Mi (was 256Mi)
   Correlates with the OOMKilled event timestamps

4. AGENT FIXES
   Agent proposes: increase memory limit back to 256Mi in values.yaml
   Agent opens a PR or commits directly to todo-app-ops-k8s

5. ADMIN VALIDATES
   Admin runs: ./scripts/orchestrate.sh validate --scenario oom-kill-nestjs
   Validator checks: pod is Running, no OOMKilled events in last 5 minutes
```

### 5.3 What Makes It Realistic

- **Realistic commits**: The injector commits with real-looking author names and messages
  (e.g., `"alex-sre <alex@todo-corp.example>"`, `"chore: right-size API memory"`)
- **Runbooks as breadcrumbs**: Each ops repo has `docs/runbooks/` written from an SRE
  perspective. The runbooks are the designed entry point for the agent.
- **No simulation artifacts**: Service and ops repos contain zero references to "injection",
  "simulation", "scenario", or "orchestrator"
- **Chained scenarios**: Some issues require changes across two repos (e.g., bad Helm config
  + a code-level retry that amplifies the failure), mirroring real cascading incidents

### 5.4 Issue Injection Flow (Admin Side)

```bash
# 1. Ensure workspace repos are cloned and up to date
./scripts/clone-workspace.sh

# 2. Inject an issue (commits to external repo with realistic message)
./scripts/orchestrate.sh inject --scenario oom-kill-nestjs --env k8s

# 3. Observe: Prometheus alert fires within ~2 minutes

# 4. Hand alert payload to the AI agent

# 5. After agent attempts fix, validate
./scripts/orchestrate.sh validate --scenario oom-kill-nestjs

# 6. Reset environment for next scenario
./scripts/orchestrate.sh reset --scenario oom-kill-nestjs
```

---

## 6. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Repo model | **Polyrepo** — each service + ops surface is a standalone repo | AI agent must not be able to detect simulation context. Monorepo structure leaks orchestration. |
| Orchestrator | Private `todo-app-monorepo` repo with shell scripts | Admin-only control plane. Never exposed to AI agent. |
| Shared schemas | `@todo-app/core` published to **GitHub Packages** (npm) | Realistic: real orgs publish shared libs to a registry. TypeScript services consume `@todo-app/core: ^1.0.0`. Python/Java/Go define equivalent schemas natively. |
| Per-service config | Each service has its own `.env.example` | No shared root `.env`. Each repo is independently deployable. Config validated by Zod at runtime (`@todo-app/core/env` in TS services). |
| Shared core logic | Hexagonal (ports/adapters) | Core logic uses Zod (works in Node + Deno). Adapters per platform handle DB, cache, logging. |
| ORM | Prisma (NestJS), SQLAlchemy (Python), JPA (Java), pgx (Go) | Best tool per runtime |
| Database | PostgreSQL (K8s/Docker/VM/Supabase) + Firestore (Firebase) | Real DB for all topologies |
| Cache | Valkey (multi-instance: K8s/Docker/VM), in-memory Map (serverless) | Valkey (BSD fork of Redis) needed for HPA/cluster — atomic `INCR`+`EXPIRE` for rate limiting. Wire-compatible with ioredis client |
| K8s routing | Gateway API v1.5 + Traefik | HTTPRoute-based routing. Community ingress-nginx archived March 2026. Traefik pre-installed in K3s |
| K8s deploy | Helm 4 umbrella chart (in `todo-app-ops-k8s`) | Standard K8s packaging. Values files per environment (dev/staging/prod). |
| K8s cloud | OCI OKE Basic (free) + Always Free ARM; fallback to k3s | Only truly free persistent option (4 OCPUs, 24GB RAM, 200GB, 1 LB) |
| VM deploy | **Kamal** v2 (13.9k stars, MIT, by 37signals) in `todo-app-ops-vm` | Zero-downtime Docker deploy to VMs via SSH. Built-in proxy, SSL, health checks. |
| Docker deploy | Docker Compose in `todo-app-ops-docker` | Standard multi-container orchestration. |
| Serverless deploy | Firebase CLI + Supabase CLI | Native platform CLIs, no abstraction needed |
| CI/CD portability | **Dagger** (optional, 15.6k stars) | Same pipeline code runs on GitHub Actions, GitLab CI, Bitbucket Pipelines. |
| VCS mirroring | GitHub Actions push-mirror (not bidirectional) | Simple, deterministic, avoids merge conflicts |
| CI/CD split | Different VCS -> different deploy targets | Realistic enterprise complexity for AI agent |
| Agent entry point | Prometheus alert with `runbookUrl` → ops repo | See Section 5. Runbooks in ops repos guide the agent to the injected issue. |

---

## 6. Deployment Tool Landscape

No single existing tool covers all 4 topologies from one config. We compose the best tool per topology:

### 6.1 What We Use

| Topology | Tool | Why This Tool |
|----------|------|---------------|
| **K8s** | **Helm 4** + **Gateway API** | Helm umbrella chart deploys entire stack. Gateway API v1.5 (HTTPRoute) for routing via Traefik. Profile YAML -> Helm values override per language |
| **VM** | **Kamal** v2 (37signals) | Docker-to-VM via SSH with zero-downtime deploys, built-in proxy (`kamal-proxy`), Let's Encrypt SSL, health checks. 13.9k stars, MIT, default in Rails 8 |
| **Docker** | **Docker Compose** | Standard. Profile selects compose file + env overrides |
| **Serverless** | **Firebase CLI + Supabase CLI** | Native platform tools, no abstraction needed |
| **CI/CD** | **Dagger** (optional) | Same pipeline in Go/TS/Python runs identically on GitHub Actions, GitLab CI, Bitbucket Pipelines. Eliminates maintaining 3 separate YAML configs |
| **Orchestration** | **Custom deploy.sh** | Thin layer: reads profile YAML, dispatches to Helm/Kamal/Compose/CLI per topology |

### 6.2 What We Evaluated But Don't Use

| Tool | Stars | Why Not |
|------|-------|---------|
| **KubeVela** (CNCF) | 7.6k | Closest to "deploy anywhere" but requires K8s as control plane even for non-K8s targets. Overkill for our scope |
| **Score** (Humanitec) | 8k | Right vision (one spec -> many targets) but only K8s + Compose implementations exist today. No VM, no serverless |
| **Coolify** | 52k | Self-hosted PaaS with web UI. Great for Docker-on-servers but no K8s, no serverless. Overlaps with Kamal |
| **Nitric** | 2k | "Infrastructure from code" -- requires using their SDK. We want framework-agnostic deployment |
| **Garden.io** | 3.6k | K8s dev workflows only. No Docker Compose, VM, or serverless support |
| **Radius** (Microsoft) | 1.6k | Ambitious but "not ready for production." K8s + Azure/AWS only |
| **Waypoint** (HashiCorp) | - | **OSS abandoned.** Now proprietary SaaS (HCP Waypoint). Do not adopt |
| **SST** | - | **Team pivoted** to AI product (OpenCode). Maintenance mode only |
| **Encore** | - | Go/TS only, locks you into their framework abstractions |
| **ingress-nginx** (community) | 18k | **Repository archived March 2026.** No further releases or security patches. Migrated to Gateway API + Traefik |

### 6.3 Kamal for VM Topology (Detail)

Kamal replaces the need for custom PM2, NGINX, systemd, and deploy scripts. Per-language Kamal config in `infra/kamal/`:

```
infra/kamal/
  nestjs/
    config/deploy.yml       # Kamal config for NestJS API
  python/
    config/deploy.yml       # Kamal config for FastAPI
  java/
    config/deploy.yml       # Kamal config for Spring Boot
  go/
    config/deploy.yml       # Kamal config for Go Gin
```

**Example Kamal config** (`infra/kamal/nestjs/config/deploy.yml`):

```yaml
service: todo-app-api
image: todo-app-api

servers:
  web:
    hosts:
      - 129.xxx.xxx.xxx       # OCI Free ARM VM IP
    labels:
      kamal-proxy-ssl: true
    options:
      memory: 256m

registry:
  server: ghcr.io
  username: sumit1993
  password:
    - KAMAL_REGISTRY_PASSWORD

builder:
  arch: arm64                   # OCI ARM instances
  args:
    DATABASE_URL: postgresql://todo:pass@localhost:5432/tododb

accessories:
  db:
    image: postgres:16-alpine
    host: 129.xxx.xxx.xxx
    port: "5432:5432"
    env:
      POSTGRES_DB: tododb
      POSTGRES_USER: todo
      POSTGRES_PASSWORD: todopass
    directories:
      - data:/var/lib/postgresql/data

  valkey:
    image: valkey/valkey:8-alpine
    host: 129.xxx.xxx.xxx
    port: "6379:6379"
    cmd: "valkey-server --maxmemory 64mb --maxmemory-policy allkeys-lru"

env:
  clear:
    NODE_ENV: production
    REDIS_URL: redis://localhost:6379
  secret:
    - DATABASE_URL
    - SENTRY_DSN

healthcheck:
  path: /api/health
  port: 3000
  interval: 10
```

**Kamal gives us for free**:
- `kamal-proxy`: Built-in reverse proxy (replaces NGINX config)
- Zero-downtime deploys (blue-green container swap)
- Let's Encrypt SSL (replaces Certbot setup)
- Health check verification before traffic switch
- `kamal app logs` / `kamal app exec` for debugging
- Accessories management (PostgreSQL, Valkey as Docker containers on same VM)
- Rolling deployments and rollback via `kamal rollback`

**What we still need**:
- `node_exporter` on the VM (for Prometheus host metrics)
- Prometheus scrape config pointing to the VM
- Kamal hook to run DB migrations pre-deploy

### 6.4 Dagger for CI/CD Portability (Optional)

Instead of maintaining 3 separate CI configs (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`), define pipelines once in Dagger:

```
infra/dagger/
  src/
    build.ts          # Build all Docker images
    test.ts           # Run tests for all languages
    deploy_k8s.ts     # Helm upgrade
    deploy_kamal.ts   # Kamal deploy
    deploy_firebase.ts
    deploy_supabase.ts
    mirror.ts         # Push to GitLab + Bitbucket
```

Each CI platform just invokes Dagger:

```yaml
# .github/workflows/deploy.yml (3 lines of actual logic)
steps:
  - uses: actions/checkout@v4
  - uses: dagger/dagger-for-github@v7
  - run: dagger call deploy-k8s --target oci

# .gitlab-ci.yml (same logic, different syntax)
deploy:
  image: registry.dagger.io/engine
  script: dagger call deploy-kamal --target oci-vm

# bitbucket-pipelines.yml (same logic again)
pipelines:
  default:
    - step:
        script: dagger call deploy-supabase
```

**Trade-off**: Dagger adds a dependency and learning curve. If 3 separate YAML files are manageable, skip it. Consider adopting after Phase 8 when CI/CD maintenance burden becomes clear.

---

## 7. Topology Details

### 7.1 Kubernetes

```
Namespaces:
  todo-app/          All 4 API services + UI + HTTPRoutes + NetworkPolicy
  data/              PostgreSQL (StatefulSet) + Valkey (Deployment)
  monitoring/        Prometheus + Grafana + Alertmanager (kube-prometheus-stack)
```

Traefik (pre-installed in K3s/Rancher Desktop) serves as the Gateway API controller. Community `kubernetes/ingress-nginx` was archived March 2026.

Per-service K8s resources: Deployment, Service, HPA, PDB, ConfigMap, Secret, ServiceMonitor, NetworkPolicy, HTTPRoute.

Gateway API routes (multi-backend):
```
/api/nestjs/*  -> api:3000
/api/python/*  -> api-python:8000
/api/java/*    -> api-java:8080
/api/go/*      -> api-go:8081
/api/*         -> default backend (configurable)
/              -> ui:3000
```

Resource budget on OCI Free (24GB RAM):

| Component | Request | Limit |
|-----------|---------|-------|
| NestJS | 128Mi | 256Mi |
| FastAPI | 64Mi | 128Mi |
| Spring Boot | 256Mi | 512Mi |
| Go | 32Mi | 64Mi |
| UI | 128Mi | 256Mi |
| PostgreSQL | 128Mi | 256Mi |
| Valkey | 32Mi | 64Mi |
| Prometheus | 256Mi | 512Mi |
| Alertmanager | 32Mi | 64Mi |
| **Total** | **~1GB** | **~2.1GB** |

~20GB headroom for system, Grafana, Elasticsearch, HPA scaling.

OCI caveats: idle instances reclaimed after 7 days (CPU/Net/Mem all < 20%), ARM capacity sometimes limited, all resources in home region only.

---

## 8. Database Schema

```sql
CREATE TABLE todos (
  id         SERIAL PRIMARY KEY,
  todo       TEXT NOT NULL,
  completed  BOOLEAN DEFAULT false,
  user_id    INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_completed ON todos(completed);
```

Connection patterns:
- K8s: `postgresql://...@postgresql.data.svc.cluster.local:5432/tododb`
- Docker: `postgresql://...@postgres:5432/tododb`
- VM: `postgresql://...@localhost:5432/tododb`
- Supabase: Supabase JS client (REST)
- Firebase: Firestore document model (different adapter entirely)

---

## 9. Free Tier Inventory

| Service | Free Tier | Used For |
|---------|-----------|----------|
| OCI OKE Basic | No control plane fee | Cloud K8s cluster |
| OCI Always Free ARM | 4 OCPUs, 24GB RAM, 200GB, 1 LB | K8s workers + VM |
| OCI Always Free AMD | 2x Micro (1/8 OCPU, 1GB each) | Auxiliary |
| Render | 750 hrs/mo, 512MB | Existing API baseline |
| Vercel | 100GB bandwidth | Existing UI baseline |
| Firebase Spark | 125K invocations, 10GB hosting | Serverless API |
| Supabase | 500K invocations, 500MB Postgres | Deno API + real DB |
| Grafana Cloud | 10K metrics, 50GB logs, 3 users | Central monitoring |
| Sentry | 5K errors, 10K transactions | Error tracking |
| Slack | Free workspace, unlimited apps | Alerts |
| GitHub | 2000 CI min/mo | Primary VCS |
| GitLab | 400 CI min/mo, 5GB | Secondary VCS |
| Bitbucket | 50 Pipeline min/mo | Tertiary VCS |

---

## 10. Deployment Framework

The same business logic deploys **completely differently** depending on language and topology. A Spring Boot app on K8s needs JVM memory tuning, longer readiness probes, and a different Dockerfile strategy than a Go binary. This section defines the deployment profiles, language characteristics, and deployment-specific issues.

### 10.1 Language Deployment Characteristics

Each language has fundamentally different build, container, runtime, and failure characteristics:

| Characteristic | NestJS (TypeScript) | FastAPI (Python) | Spring Boot (Java) | Gin (Go) |
|---|---|---|---|---|
| **Build tool** | `npm run build` (SWC) | `pip install -r requirements.txt` | `mvn package -DskipTests` | `go build -o server ./cmd/server` |
| **Runtime command** | `node dist/main.js` | `uvicorn main:app` | `java -jar app.jar` | `./server` (static binary) |
| **Base image** | `node:20-alpine` (~180MB) | `python:3.12-slim` (~150MB) | `eclipse-temurin:21-jre-alpine` (~200MB) | `scratch` or `gcr.io/distroless` (~15MB) |
| **Final image size** | ~150-200MB | ~120-180MB | ~250-350MB | ~15-25MB |
| **Startup time** | ~2-3s | ~1-2s | ~8-15s | ~50-100ms |
| **Memory baseline** | ~80-120MB | ~40-80MB | ~200-400MB | ~10-20MB |
| **Process model** | Single-threaded event loop | Async event loop (uvloop) OR multi-worker (gunicorn) | Multi-threaded (Tomcat thread pool) | Goroutines (M:N scheduling) |
| **Concurrency** | Non-blocking I/O, single CPU core | GIL limits CPU parallelism; need workers for CPU tasks | True multi-threading, multiple cores | True parallelism via goroutines |
| **Metrics library** | `prom-client` | `prometheus_client` | Micrometer + `micrometer-registry-prometheus` | `prometheus/client_golang` |
| **Logging** | Winston | `structlog` or `loguru` | Logback + SLF4J | `zerolog` or `zap` |
| **ORM / DB client** | Prisma | SQLAlchemy + asyncpg | Spring Data JPA + Hibernate | GORM or pgx |
| **Health check endpoint** | `/api/health` | `/api/health` | `/actuator/health` (Spring convention) | `/api/health` |
| **Metrics endpoint** | `/api/metrics` | `/api/metrics` | `/actuator/prometheus` (Spring convention) | `/api/metrics` |
| **Graceful shutdown** | `onApplicationShutdown` hook | Signal handlers (SIGTERM) | `@PreDestroy` + shutdown hooks | `signal.Notify` + context cancel |

### 10.2 Dockerfile Strategy Per Language

Each language needs a fundamentally different multi-stage Dockerfile:

**NestJS** -- Classic Node.js multi-stage:
```
Stage 1: node:20-alpine         -> npm ci, npm run build
Stage 2: node:20-alpine         -> copy dist/ + node_modules, run node dist/main.js
Key: prune devDependencies, use .dockerignore, run as non-root user
```

**FastAPI** -- Python with virtual env:
```
Stage 1: python:3.12-slim       -> pip install to /venv
Stage 2: python:3.12-slim       -> copy /venv, run uvicorn
Key: no pip cache, pin requirements, --no-compile for smaller image
Variant: gunicorn with multiple workers for CPU-bound (gunicorn -w 4 -k uvicorn.workers.UvicornWorker)
```

**Spring Boot** -- JRE-only runtime (NOT JDK):
```
Stage 1: maven:3.9-eclipse-temurin-21   -> mvn package
Stage 2: eclipse-temurin:21-jre-alpine   -> copy app.jar, run java -jar
Key: -Xmx384m, -XX:+UseContainerSupport, -XX:MaxRAMPercentage=75
Variant: Spring Boot layered JARs for better Docker layer caching
```

**Go** -- Smallest possible image:
```
Stage 1: golang:1.22-alpine     -> go build -ldflags="-s -w" -o server
Stage 2: scratch (or distroless) -> copy binary only, run ./server
Key: CGO_ENABLED=0 for static binary, no shell in scratch (can't exec into container)
Variant: alpine base if you need shell access for debugging
```

### 10.3 K8s Deployment Differences Per Language

Even deploying to the same K8s cluster, each language needs different configuration:

| K8s Config | NestJS | FastAPI | Spring Boot | Go |
|---|---|---|---|---|
| **Readiness probe** | initialDelay: 5s, period: 5s | initialDelay: 3s, period: 5s | initialDelay: **30s**, period: 10s | initialDelay: 1s, period: 3s |
| **Liveness probe** | initialDelay: 15s, period: 10s | initialDelay: 10s, period: 10s | initialDelay: **60s**, period: 15s | initialDelay: 5s, period: 10s |
| **Memory request** | 128Mi | 64Mi | **256Mi** | 32Mi |
| **Memory limit** | 256Mi | 128Mi | **512Mi** | 64Mi |
| **CPU request** | 100m | 50m | 200m | 25m |
| **HPA CPU target** | 70% | 70% | **60%** (GC spikes) | 80% |
| **initContainer** | Prisma migrate | Alembic migrate | Flyway/Liquibase migrate | goose/golang-migrate |
| **Env vars** | NODE_ENV, DATABASE_URL | PYTHONUNBUFFERED=1, DATABASE_URL | JAVA_OPTS, SPRING_DATASOURCE_URL | DATABASE_URL, GOMAXPROCS |
| **JVM flags** | N/A | N/A | `-Xmx384m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75` | N/A |
| **Sidecar needs** | None | None | JMX exporter (optional) | None |

### 10.4 Deployment Profiles

A **profile** is a deployable combination of: API language + topology + components. Each is a YAML file that drives the deployment tooling.

```
infra/profiles/
  # Kubernetes profiles
  nestjs-k8s-full.yaml          NestJS + PG + Valkey + full monitoring on K8s
  python-k8s-full.yaml          FastAPI + PG + Valkey + full monitoring on K8s
  java-k8s-full.yaml            Spring Boot + PG + Valkey + full monitoring on K8s
  go-k8s-full.yaml              Gin + PG + Valkey + full monitoring on K8s
  polyglot-k8s.yaml             ALL 4 APIs + PG + Valkey + monitoring on K8s

  # Docker Compose profiles
  nestjs-docker-full.yaml       NestJS + PG + Valkey + ELK + Prometheus on Docker
  python-docker-minimal.yaml    FastAPI + PG only on Docker
  polyglot-docker.yaml          ALL 4 APIs + full stack on Docker

  # VM profiles (via Kamal)
  nestjs-vm.yaml                NestJS + PG + Valkey on VM via Kamal
  python-vm.yaml                FastAPI + PG + Valkey on VM via Kamal
  java-vm.yaml                  Spring Boot + PG + Valkey on VM via Kamal
  go-vm.yaml                    Go binary + PG on VM via Kamal

  # Serverless profiles
  firebase.yaml                 Firebase Functions + Firestore + Hosting
  supabase.yaml                 Supabase Edge Functions + Postgres
```

**Profile YAML schema:**

```yaml
name: nestjs-k8s-full
description: "Full NestJS stack on Kubernetes with complete monitoring"

# What to deploy
api: nestjs                       # nestjs | python | java | go | all
ui: nextjs
topology: kubernetes              # kubernetes | docker | vm | serverless

# Target environment
target: local                     # local | oci | render
namespace: todo-app

# Components to include
components:
  database:
    type: postgresql
    version: "16"
    storage: 10Gi
  cache:
    type: valkey
    version: "8"
    maxmemory: 64mb
  monitoring:
    prometheus: true
    grafana: true
    alertmanager: true
  logging:
    elasticsearch: false          # optional, heavy
    loki: true

# Build configuration
build:
  command: "turbo run build --filter=api"
  docker:
    context: ./apps/api
    file: ./apps/api/Dockerfile
    platforms: [linux/amd64, linux/arm64]
    tag: "todo-app-api:{{git-sha}}"

# Deploy configuration
deploy:
  method: helm
  chart: ./infra/helm/umbrella
  values:
    api.enabled: true
    api.image: todo-app-api:{{git-sha}}
    api.replicas: 2
    api.resources.requests.memory: 128Mi
    api.resources.limits.memory: 256Mi
    api.readinessProbe.initialDelaySeconds: 5
    ui.enabled: true
    postgresql.enabled: true
    valkey.enabled: true
    monitoring.enabled: true

# Runtime characteristics (used by issue injection to calibrate scenarios)
characteristics:
  startup_time: 3s
  memory_baseline: 120MB
  process_model: event-loop
  container_size: 150MB
  graceful_shutdown: true
  health_endpoint: /api/health
  metrics_endpoint: /api/metrics

# Issues applicable to this specific profile
applicable_issues:
  # Language-specific
  - nestjs-prisma-migration-timeout
  - nestjs-event-loop-blocking
  - nestjs-memory-heap-limit
  # Topology-specific
  - k8s-oomkilled
  - k8s-hpa-thrashing
  - k8s-network-policy-block
  # Data-layer
  - db-connection-pool-full
  - db-slow-query-missing-index
  - cache-redis-maxmemory
```

**VM profile example** (contrast with K8s above -- same app, completely different deploy):

```yaml
name: java-vm
description: "Spring Boot on OCI ARM VM via Kamal"

api: java
ui: nextjs
topology: vm

target: oci
host: 129.xxx.xxx.xxx

components:
  database:
    type: postgresql              # Kamal accessory (Docker on same VM)
  cache:
    type: valkey                   # Kamal accessory
  monitoring:
    node_exporter: true           # Host metrics for Prometheus
    prometheus_scrape: true       # Prometheus scrapes from central instance

build:
  command: "turbo run build --filter=api-java"
  docker:
    context: ./apps/api-java
    platforms: [linux/arm64]       # OCI ARM only
    tag: "todo-app-api-java:{{git-sha}}"

deploy:
  method: kamal                    # NOT helm -- Kamal handles VM deployment
  config: ./infra/kamal/java/config/deploy.yml
  accessories: [db, valkey]        # Kamal manages PG + Valkey as Docker containers on VM
  pre_deploy:
    - "docker exec todo-app-api-java-db-1 psql -U todo tododb -c 'SELECT 1'"   # verify DB
  healthcheck:
    path: /actuator/health         # Spring Boot convention (different from NestJS!)
    port: 8080
    interval: 15                   # longer interval -- JVM startup is slow
    max_attempts: 30               # 30 x 15s = 7.5 min max wait (JVM needs it)

characteristics:
  startup_time: 12s                # JVM is slow
  memory_baseline: 350MB           # JVM is heavy
  process_model: multi-threaded
  container_size: 300MB
  graceful_shutdown: true
  health_endpoint: /actuator/health
  metrics_endpoint: /actuator/prometheus
  jvm_flags: "-Xmx384m -XX:+UseContainerSupport -XX:MaxRAMPercentage=75"

applicable_issues:
  # Language-specific
  - startup-jvm-slow
  - runtime-jvm-gc-pauses
  - runtime-java-connection-pool
  - container-jvm-memory
  # Topology-specific (VM/Kamal)
  - kamal-accessory-disk-full       # PG data volume fills VM disk
  - kamal-proxy-ssl-renewal         # Let's Encrypt cert renewal fails
  - kamal-deploy-healthcheck-timeout # Java too slow for Kamal's default health timeout
  - vm-ssh-key-expired              # Deploy fails -- SSH key rotated
  # Data-layer
  - db-connection-pool-full
  - deploy-flyway-checksum
```

### 10.5 Orchestrator CLI

All admin operations go through `scripts/orchestrate.sh` in the private orchestrator repo.
This script is never visible to the AI agent.

```bash
# Initial setup: clone all service + ops repos into workspace/
./scripts/clone-workspace.sh

# Deploy an environment (runs helm/compose/kamal against the ops repo)
./scripts/orchestrate.sh deploy --env k8s --target local
./scripts/orchestrate.sh deploy --env k8s --target oci
./scripts/orchestrate.sh deploy --env docker
./scripts/orchestrate.sh deploy --env vm --target oci

# Inject an issue (commits bad config/code to the external repo with realistic author+message)
./scripts/orchestrate.sh inject --scenario startup-jvm-slow --env k8s
./scripts/orchestrate.sh inject --scenario oom-kill-nestjs --env k8s

# Validate that the AI agent fixed the issue
./scripts/orchestrate.sh validate --scenario startup-jvm-slow

# Reset: revert injected changes in the external repo
./scripts/orchestrate.sh reset --scenario startup-jvm-slow

# Status of all running deployments
./scripts/orchestrate.sh status

# Switch which API the gateway routes /api/* to
./scripts/orchestrate.sh switch --backend python --env k8s

# Tear down
./scripts/orchestrate.sh teardown --env k8s
```

Under the hood, `orchestrate.sh` dispatches to the right tool per topology:

| Topology | What `orchestrate.sh` Runs |
|----------|---------------------------|
| K8s | `helm upgrade --install` using charts from `workspace/todo-app-ops-k8s/helm/` |
| Docker | `docker compose up -d` using files from `workspace/todo-app-ops-docker/` |
| VM | `kamal deploy` using config from `workspace/todo-app-ops-vm/kamal/<language>/` |
| Serverless | `firebase deploy` / `supabase functions deploy` |

**The key insight**: `orchestrate.sh` is a thin dispatcher. The real deployment configs live
in the ops repos (`todo-app-ops-k8s`, `todo-app-ops-docker`, `todo-app-ops-vm`) — exactly
where the AI agent would look. The orchestrator just manages the workspace clones.

Kamal-specific commands via orchestrate.sh:
```bash
./scripts/orchestrate.sh deploy --env vm --target oci    # kamal deploy
./scripts/orchestrate.sh rollback --env vm               # kamal rollback
./scripts/orchestrate.sh logs --env vm --service nestjs  # kamal app logs
./scripts/orchestrate.sh exec --env vm -- bash           # kamal app exec
```

### 10.6 Deployment-Specific Issue Scenarios

Issues that exist **because of how** the app is deployed, not bugs in the app code:

#### Build-Time Issues

| ID | Issue | Language | Topology | What Happens |
|---|---|---|---|---|
| `build-npm-platform` | node_modules platform mismatch | NestJS | Any | `npm ci` on macOS, copy to Linux container -> native modules crash |
| `build-pip-native-arm` | pip install fails on ARM | FastAPI | K8s (OCI ARM) | C extension won't compile for aarch64 |
| `build-mvn-dependency` | Maven dependency resolution timeout | Spring Boot | CI/CD | Corporate proxy or flaky Maven Central -> build hangs |
| `build-go-cgo-cross` | CGO cross-compilation failure | Go | K8s (multi-arch) | CGO_ENABLED=1 + cross-compile -> linker error |

#### Container-Time Issues

| ID | Issue | Language | Topology | What Happens |
|---|---|---|---|---|
| `container-jvm-memory` | JVM ignores container memory limit | Spring Boot | K8s/Docker | Without `-XX:+UseContainerSupport`, JVM sees host RAM -> allocates 25% of node memory -> OOMKilled |
| `container-python-workers` | Wrong gunicorn worker count | FastAPI | K8s/Docker | `workers = (2 * cpu_count) + 1` sees host CPUs, not container limit -> spawns 17 workers -> OOMKilled |
| `container-go-maxprocs` | GOMAXPROCS defaults to host CPUs | Go | K8s | Go runtime uses all host CPUs -> steals CPU from other pods -> noisy neighbor |
| `container-node-heap` | Node.js heap exceeds container limit | NestJS | K8s/Docker | Default V8 heap limit (~1.5GB) exceeds 256Mi pod limit -> OOMKilled under load |
| `container-scratch-no-shell` | Can't exec into scratch container | Go | K8s | `kubectl exec` fails -- no `/bin/sh` in scratch image -> can't debug in container |
| `container-distroless-no-tools` | No curl/wget in distroless | Go/Java | K8s | Health check with `exec curl` fails -- no curl binary -> use TCP/HTTP probe instead |

#### Startup-Time Issues

| ID | Issue | Language | Topology | What Happens |
|---|---|---|---|---|
| `startup-jvm-slow` | JVM startup exceeds readiness timeout | Spring Boot | K8s | 8-15s startup + class loading + bean init > readinessProbe initialDelay (5s) -> pod killed before ready -> CrashLoopBackOff |
| `startup-prisma-migration` | Prisma migrate blocks pod startup | NestJS | K8s | initContainer runs `prisma migrate deploy` -> slow on large schema or cold DB connection -> pod restart timeout |
| `startup-python-import` | Slow module imports at startup | FastAPI | K8s | Heavy dependencies (pandas, numpy if used) -> 5-10s import time -> readiness probe fails |
| `startup-go-instant` | Go starts before DB is ready | Go | K8s/Docker | Go binary starts in 50ms, immediately tries DB connection -> PostgreSQL not ready yet -> crash -> needs retry or depends_on |

#### Runtime Issues (Topology x Language)

| ID | Issue | Language | Topology | What Happens |
|---|---|---|---|---|
| `runtime-pm2-state` | PM2 cluster mode + in-memory cache | NestJS | VM | Each PM2 worker has separate cache -> user sees inconsistent data across requests -> need Redis |
| `runtime-gunicorn-prefork` | Worker memory multiplication | FastAPI | VM/Docker | 4 gunicorn workers x 80MB each = 320MB (vs expected 80MB) -> memory budget blown |
| `runtime-jvm-gc-pauses` | GC stop-the-world pauses | Spring Boot | K8s | Full GC pauses -> latency spikes -> HPA triggers scale-up -> more memory pressure -> more GC -> cascade |
| `runtime-goroutine-leak-oom` | Goroutine leak invisible until OOM | Go | K8s | Leaked goroutines accumulate slowly -> no visible CPU spike -> eventually OOMKilled with no warning |
| `runtime-node-event-loop-lag` | Event loop blocking | NestJS | Any | Synchronous operation blocks event loop -> ALL requests stall -> appears as service down, not high CPU |
| `runtime-python-gil` | GIL contention under CPU load | FastAPI | K8s/Docker | CPU-bound request blocks all async handlers -> need separate process workers, not just async |
| `runtime-java-connection-pool` | Hibernate connection pool leak | Spring Boot | K8s | Transaction not closed in error path -> connections accumulate -> pool exhausted -> all requests fail after ~10min |
| `runtime-go-context-cancel` | Missing context cancellation | Go | K8s | Client disconnects but server keeps processing -> wasted CPU -> goroutine builds up |

#### Migration/Deploy-Time Issues

| ID | Issue | Language | Topology | What Happens |
|---|---|---|---|---|
| `deploy-prisma-drift` | Prisma schema drift | NestJS | K8s | Schema edited manually in DB -> `prisma migrate deploy` fails -> pod stuck in init -> service down |
| `deploy-alembic-conflict` | Alembic migration branch conflict | FastAPI | K8s | Two developers create migrations -> branch conflict -> deploy fails |
| `deploy-flyway-checksum` | Flyway checksum mismatch | Spring Boot | K8s | Modified an already-applied migration -> checksum validation fails -> app won't start |
| `deploy-goose-order` | goose migration ordering | Go | K8s | Timestamped migrations applied out of order -> foreign key references nonexistent table |
| `deploy-helm-values-mismatch` | Wrong Helm values for language | Any | K8s | Using NestJS readiness probe timing (5s) for Spring Boot (needs 30s) -> CrashLoopBackOff |
| `deploy-docker-layer-cache` | Stale Docker layer cache | Any | Docker/K8s | `npm ci` cached but `package-lock.json` changed -> old dependencies -> runtime error |

#### Kamal/VM-Specific Issues

| ID | Issue | Language | What Happens |
|---|---|---|---|
| `kamal-accessory-disk-full` | PostgreSQL data fills VM disk | Any | Kamal accessory PG writes to Docker volume, 200GB OCI disk fills -> DB crashes -> 500s |
| `kamal-proxy-ssl-renewal` | Let's Encrypt cert renewal fails | Any | kamal-proxy can't reach ACME server (firewall) -> cert expires -> HTTPS broken |
| `kamal-deploy-health-timeout` | Kamal health check times out | Java | Default Kamal health timeout (7s) too short for JVM -> deploy rolls back -> stuck on old version |
| `kamal-ssh-key-expired` | SSH key rotated on VM | Any | `kamal deploy` fails with "Permission denied" -> can't deploy any language until key fixed |
| `kamal-registry-auth` | Container registry token expired | Any | `kamal deploy` can't pull image from GHCR -> deploy fails at image pull step |
| `kamal-accessory-restart` | Redis accessory OOMKilled | Any | Redis exceeds Docker memory limit on VM -> accessory restarts -> cache lost -> cache stampede |

### 10.7 Profile-Issue Matrix

Which issues apply to which deployment profile:

| Issue Category | NestJS K8s | Python K8s | Java K8s | Go K8s | NestJS Docker | NestJS VM (Kamal) | Firebase | Supabase |
|---|---|---|---|---|---|---|---|---|
| Build-time | npm-platform | pip-native-arm | mvn-dependency | go-cgo-cross | npm-platform | npm-platform | - | - |
| Container | node-heap | python-workers | jvm-memory | go-maxprocs, scratch-no-shell | node-heap | node-heap | - | - |
| Startup | prisma-migration | python-import | **jvm-slow** | go-instant | - | kamal-health-timeout | cold-start | cold-start |
| Runtime (language) | event-loop-lag | gil-contention | gc-pauses, connection-pool | goroutine-leak | event-loop-lag | event-loop-lag | stateless | stateless |
| Migration | prisma-drift | alembic-conflict | flyway-checksum | goose-order | prisma-drift | prisma-drift | - | - |
| Kamal/VM | - | - | - | - | - | ssh-key, ssl-renewal, accessory-disk, registry-auth | - | - |
| Infrastructure | all 9 K8s issues | all 9 K8s issues | all 9 K8s issues | all 9 K8s issues | docker network issues | kamal-accessory-restart | firebase quota | supabase timeout |

### 10.8 Monitoring Differences Per Language

Each language exposes metrics and logs differently, requiring different Prometheus scrape configs, different Grafana dashboards, and different alert thresholds:

| Aspect | NestJS | FastAPI | Spring Boot | Go |
|---|---|---|---|---|
| **Scrape path** | `/api/metrics` | `/api/metrics` | `/actuator/prometheus` | `/api/metrics` |
| **Default metrics** | process CPU, memory, event loop lag, GC | process CPU, memory, GC | JVM heap, threads, GC pauses, Hikari pool | goroutine count, GC, memory, scheduler |
| **Key metric to watch** | `nodejs_eventloop_lag_seconds` | `python_gc_collections_total` | `jvm_memory_used_bytes{area="heap"}` | `go_goroutines` |
| **OOM signal** | RSS approaching limit | RSS approaching limit | Heap + Metaspace approaching limit | RSS (goroutine stacks) |
| **Latency signal** | Event loop lag > 100ms | GIL wait time | GC pause time > 200ms | Goroutine scheduler latency |
| **Log format** | JSON (Winston) | JSON (structlog) | JSON (Logback + logstash-encoder) | JSON (zerolog) |
| **Correlation ID header** | `x-correlation-id` (custom middleware) | `x-correlation-id` (custom middleware) | `x-correlation-id` (Spring filter) | `x-correlation-id` (Gin middleware) |
| **Error tracking** | `@sentry/nestjs` | `sentry-sdk[fastapi]` | `sentry-spring-boot-starter-jakarta` | `sentry-go` |

---

## 11. Issue Injection System (Expanded)

### 11.1 Issue Categories (56 Total)

The original 33 scenarios (infra/app/config/db/deploy/security/cross-service) plus 28 deployment-specific scenarios from Section 9.6 and 6 Kamal/VM scenarios:

| Category | Count | Source |
|----------|-------|--------|
| Infrastructure (K8s) | 9 | OOMKilled, CrashLoop, ImagePull, NetworkPolicy, DNS, disk, HPA, node, quota |
| Application (code bugs) | 4 | Memory leak, connection pool, unhandled rejection, event loop block |
| Configuration | 5 | Missing env, wrong DB, bad CORS, TLS expiry, wrong API URL |
| Database | 4 | Slow query, pool full, replication lag, migration failure |
| Deployment | 3 | Bad image tag, failed migration, canary errors |
| Security | 4 | Debug endpoint, no rate limit, SQL injection, leaked key |
| Cross-Service | 4 | Timeout mismatch, cache race, correlation break, circuit breaker |
| **Build-Time** | **4** | npm platform, pip ARM, Maven timeout, CGO cross-compile |
| **Container-Time** | **6** | JVM memory, Python workers, GOMAXPROCS, Node heap, scratch shell, distroless tools |
| **Startup-Time** | **4** | JVM slow, Prisma migration, Python imports, Go DB race |
| **Runtime (lang x topo)** | **8** | PM2 state, gunicorn prefork, GC pauses, goroutine OOM, event loop, GIL, Hibernate pool, context cancel |
| **Migration/Deploy** | **6** | Prisma drift, Alembic conflict, Flyway checksum, goose order, Helm values, Docker cache |
| **Kamal/VM** | **6** | Accessory disk full, SSL renewal fail, health timeout, SSH key expired, registry auth, accessory OOM |
| **Total** | **67** | |

### 11.2 Scenario Lifecycle

```
1. DEPLOY env        ->  ./scripts/orchestrate.sh deploy --env k8s --target local
2. INJECT issue      ->  ./scripts/orchestrate.sh inject --scenario startup-jvm-slow --env k8s
                         (commits bad Helm values to workspace/todo-app-ops-k8s
                          with a realistic author + commit message, then pushes to GitHub)
3. OBSERVE symptoms  ->  Grafana dashboard, Slack alert (#critical), kubectl events
                         Alert contains runbookUrl → todo-app-ops-k8s/docs/runbooks/jvm-slow.md
4. AI AGENT detects  ->  Agent reads alert, follows runbookUrl, clones ops repo
5. AI AGENT diagnoses->  Finds recent "cost savings" commit that lowered readiness probe delays
6. AI AGENT resolves ->  Patches readinessProbe.initialDelaySeconds back to 30s in values.yaml
7. VALIDATE fix      ->  ./scripts/orchestrate.sh validate --scenario startup-jvm-slow
8. CLEANUP           ->  ./scripts/orchestrate.sh reset --scenario startup-jvm-slow
```

### 11.3 Scenario YAML (Deployment-Aware)

```yaml
id: startup-jvm-slow
name: "JVM startup exceeds K8s readiness probe"
category: startup
severity: critical
language: java
topology: [kubernetes]
profiles: [java-k8s-full, polyglot-k8s]

description: |
  Spring Boot takes 8-15s to start (class loading, bean initialization,
  connection pool warmup). The default readiness probe has initialDelaySeconds: 5,
  which is tuned for NestJS/Go. Kubernetes kills the pod before Spring finishes
  starting, causing CrashLoopBackOff.

injection:
  type: helm-values-override
  target_repo: todo-app-ops-k8s             # external repo to commit to
  commit_message: "chore: align probe timing with NestJS defaults across all services"
  commit_author: "alex-sre <alex@todo-corp.example>"
  steps:
    - action: patch-file
      file: helm/api-java/values.yaml
      set:
        readinessProbe.initialDelaySeconds: 5     # too short for Java (was 30)
        readinessProbe.timeoutSeconds: 1
        livenessProbe.initialDelaySeconds: 10     # also too short (was 60)

expected_symptoms:
  pod_status: CrashLoopBackOff
  events:
    - "Readiness probe failed: connection refused"
    - "Back-off restarting failed container"
  prometheus:
    - 'kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} > 0'
    - 'kube_pod_container_status_restarts_total > 3'
  alerts:
    - name: ServiceDown
      expected_within: 2m
  grafana:
    - panel: "Pod Restart Count" shows increasing restarts
    - panel: "Service Availability" drops to 0%

root_cause: |
  Readiness probe timing mismatch. NestJS starts in 2-3s, Go in 50ms,
  but Spring Boot needs 8-15s. The Helm chart used NestJS-calibrated probe
  timing for the Java deployment.

resolution:
  description: "Increase probe delays to match JVM startup time"
  steps:
    - action: helm-upgrade
      set:
        api-java.readinessProbe.initialDelaySeconds: 30
        api-java.readinessProbe.timeoutSeconds: 5
        api-java.readinessProbe.periodSeconds: 10
        api-java.livenessProbe.initialDelaySeconds: 60
    - verify: "kubectl get pods shows Running/Ready"
    - verify: "No new restarts in 2 minutes"

ai_agent_hints:
  discovery:
    - "kubectl get pods shows CrashLoopBackOff for java pod only"
    - "kubectl describe pod shows readiness probe failures"
    - "Other language pods (nestjs, go, python) are healthy"
  diagnosis:
    - "Compare startup times: Java takes 8-15s, probe fires at 5s"
    - "Check probe configuration: initialDelaySeconds is too low for JVM"
  fix:
    - "Increase initialDelaySeconds to 30-60s for Java"
    - "Add startupProbe as alternative (K8s 1.18+)"

cleanup:
  - action: helm-upgrade
    set:
      api-java.readinessProbe.initialDelaySeconds: 30   # keep correct value
```

---

## 12. Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Turborepo monorepo + NestJS API + PostgreSQL/Valkey + core extraction | ✅ Done |
| 1 | PostgreSQL + Valkey integration, hexagonal arch, Helm charts (local) | ✅ Done |
| 1.5 | **Polyrepo decomposition** — extract service repos, ops repos, publish `@todo-app/core` | 🔄 In Progress |
| 2 | K8s topology — `todo-app-ops-k8s`, OCI OKE, Gateway API, `orchestrate.sh` | Pending |
| 3 | VM + Docker topologies — `todo-app-ops-vm` (Kamal), `todo-app-ops-docker` | Pending |
| 4 | Multi-language APIs — `todo-app-api-python`, `todo-app-api-go`, `todo-app-api-java` + per-language ops configs | Pending |
| 5 | Serverless adapters — `todo-app-firebase-api`, `todo-app-supabase-api` | Pending |
| 6 | Issue injection system — 67 scenarios + cross-repo injector/validator in orchestrator | Pending |
| 7 | Monitoring + Sentry + Slack + runbooks in ops repos | Pending |
| 8 | Multi-VCS + CI/CD per service repo (+ optional Dagger for portability) | Pending |

### Phase 1.5 Detail: Polyrepo Decomposition

Extract from this monorepo into standalone repos:
- `todo-app-api-nestjs` — from `apps/api` (reuse existing GitHub repo if available)
- `todo-app-ui` — from `apps/ui` (reuse existing GitHub repo)
- `todo-app-ops-k8s` — from `infra/helm/`
- `todo-app-ops-docker` — from `infra/docker/dev/`
- `todo-app-ops-vm` — from `infra/kamal/`
- `@todo-app/core` — publish `packages/core` to GitHub Packages

Transform this repo into the private orchestrator:
- Remove `apps/`, `packages/` from tracked files (move to `workspace/` or delete)
- Replace `deploy.sh` with `scripts/orchestrate.sh`
- Remove `turbo.json` (orchestrator uses shell scripts, not Turborepo)

---

## 13. Success Criteria

### Polyrepo integrity (Phase 1.5)
- [ ] `git clone todo-app-api-nestjs && pnpm install && pnpm build && pnpm test` passes with no knowledge of orchestrator
- [ ] `git clone todo-app-ui && pnpm install && pnpm build` passes standalone
- [ ] `helm lint` passes for all charts in `todo-app-ops-k8s`
- [ ] An AI agent given access only to `todo-app-api-nestjs` + `todo-app-ops-k8s` cannot detect simulation context from any file in those repos
- [ ] `@todo-app/core` published to GitHub Packages and consumable as `npm install @todo-app/core`

### Deployment (Phase 2-3)
- [ ] `./scripts/orchestrate.sh deploy --env k8s --target local` deploys full stack
- [ ] `./scripts/orchestrate.sh deploy --env k8s --target oci` deploys all APIs to OCI
- [ ] `./scripts/orchestrate.sh deploy --env docker` → all services healthy
- [ ] `./scripts/orchestrate.sh deploy --env vm --target oci` → Kamal deploys with kamal-proxy + SSL
- [ ] `./scripts/orchestrate.sh switch --backend python --env k8s` routes /api/* to FastAPI

### Multi-language (Phase 4)
- [ ] All 4 APIs return identical responses for the same requests
- [ ] UI backend selector switches between 4 API implementations
- [ ] Firebase + Supabase emulators serve CRUD

### Observability (Phase 7)
- [ ] Grafana Cloud dashboards show metrics from all topologies + all languages
- [ ] Per-language metrics: event loop lag (Node), GC pauses (Java), goroutine count (Go)
- [ ] Sentry captures errors with platform + language tags
- [ ] Slack receives alerts when a service goes down
- [ ] Prometheus alert `runbookUrl` links resolve to real runbook docs in ops repos

### Issue injection (Phase 6)
- [ ] `./scripts/orchestrate.sh inject --scenario startup-jvm-slow --env k8s` → CrashLoopBackOff visible in Grafana + Slack
- [ ] `./scripts/orchestrate.sh inject --scenario oom-kill-nestjs --env k8s` → OOMKilled alert fires with correct runbookUrl
- [ ] `./scripts/orchestrate.sh validate --scenario startup-jvm-slow` → passes after agent fixes probe timing
- [ ] Injected commits have realistic author names and messages (no "orchestrator" or "inject" in git log)

### VCS + CI/CD (Phase 8)
- [ ] Push to GitHub → GitLab + Bitbucket mirrors update
- [ ] `k6` load test populates all dashboards
