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

| Package | Stack | Status |
|---------|-------|--------|
| `apps/api` | NestJS 11, Node 20, PostgreSQL 16, Redis 7 | Working (local) |
| `apps/ui` | Next.js 15, React 19 | Working (local) |
| `packages/core` | Zod schemas, ports/adapters interfaces | Done |
| `packages/db` | Prisma 7, PostgreSQL, migrations, seed | Done |
| `infra/docker/dev` | Docker Compose (PostgreSQL + Redis) | Done |

- API uses real PostgreSQL database with Prisma 7 ORM (adapter-pg driver) and Redis cache (ioredis)
- Hexagonal architecture: core defines ports (ITodoRepository, ICacheProvider, ILogger), API provides adapters
- 7 intentionally planted code-level bugs preserved (validation gap, correlation ID loss, cache TTL, closure capture, timeout mismatch, aggressive retry, rate limiter race)
- Local Prometheus + Alertmanager with 6 alert rules
- DevSpace + Helm charts for local K8s (Rancher Desktop)
- VCS: GitHub only

---

## 4. Target State

### 4.1 Repository: New Turborepo Monorepo

Create a **new** GitHub repo with fresh git history. Copy code from the 3 existing repos. Archive originals as read-only reference (preserving PR/bug injection history).

```
todo-app/
  turbo.json
  package.json

  apps/
    api/              TypeScript    NestJS 11       port 3000
    api-python/       Python        FastAPI         port 8000
    api-java/         Java          Spring Boot     port 8080
    api-go/           Go            Gin             port 8081
    ui/               TypeScript    Next.js 15      port 3000
    firebase-api/     TypeScript    Cloud Functions
    supabase-api/     TypeScript    Deno Edge Fn

  packages/
    core/             Shared business logic (zod, ports/adapters, ZERO Node.js deps)
    db/               Prisma schema, client, migrations, seed
    config/           Shared ESLint, TypeScript, Prettier

  infra/
    helm/             K8s Helm charts (api, ui, postgresql, redis, monitoring, umbrella)
    docker/           Docker Compose full stack
    kamal/            Kamal deploy configs per language (VM topology)
    profiles/         Deployment profile YAMLs (the "button" to deploy any combination)
    issues/           Issue injection system (67 scenarios)
    prometheus/       Prometheus + Alertmanager configs
    scripts/          Load test, deploy-all, health-check-all
    dagger/           Optional: portable CI/CD pipelines (same pipeline on GH/GL/BB)
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

## 5. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo tool | Turborepo | Build caching, parallel execution, dependency graph. Non-JS apps use thin `package.json` wrappers |
| Shared core | Hexagonal (ports/adapters) | Core logic uses zod (works in Node + Deno). Adapters per platform handle DB, cache, logging |
| ORM | Prisma (NestJS), Supabase client (Deno), Firestore SDK (Firebase) | Best tool per runtime |
| Database | PostgreSQL (K8s/Docker/VM/Supabase) + Firestore (Firebase) | Real DB replaces dummyjson.com proxy |
| Cache | Redis (multi-instance: K8s/Docker/VM), in-memory Map (serverless) | Redis needed for HPA/cluster -- atomic `INCR`+`EXPIRE` for rate limiting |
| K8s deploy | Helm umbrella chart | Standard K8s packaging. Profile YAML generates Helm values overrides per language |
| K8s cloud | OCI OKE Basic (free) + Always Free ARM; fallback to k3s | Only truly free persistent option (4 OCPUs, 24GB RAM, 200GB, 1 LB) |
| VM deploy | **Kamal** (13.9k stars, MIT, by 37signals) | Zero-downtime Docker deploy to VMs via SSH. Built-in proxy, SSL, health checks. Replaces custom PM2/NGINX/systemd scripts |
| Docker deploy | Docker Compose | Standard multi-container orchestration. Profile selects which compose file + overrides |
| Serverless deploy | Firebase CLI + Supabase CLI | Native platform CLIs, no abstraction needed |
| CI/CD portability | **Dagger** (optional, 15.6k stars) | Same pipeline code runs on GitHub Actions, GitLab CI, Bitbucket Pipelines. Eliminates 3x YAML maintenance |
| VCS mirroring | GitHub Actions push-mirror (not bidirectional) | Simple, deterministic, avoids merge conflicts |
| CI/CD split | Different VCS -> different deploy targets | Realistic enterprise complexity for AI agent |
| Fresh monorepo | New repo, no git history migration | Clean slate; originals preserve bug-injection PR timeline |

---

## 6. Deployment Tool Landscape

No single existing tool covers all 4 topologies from one config. We compose the best tool per topology:

### 6.1 What We Use

| Topology | Tool | Why This Tool |
|----------|------|---------------|
| **K8s** | **Helm** | Industry standard. Umbrella chart deploys entire stack. Profile YAML -> Helm values override per language |
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

  redis:
    image: redis:7-alpine
    host: 129.xxx.xxx.xxx
    port: "6379:6379"
    cmd: "redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru"

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
- Accessories management (PostgreSQL, Redis as Docker containers on same VM)
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
  ingress-system/    NGINX Ingress Controller
  todo-app/          All 4 API services + UI + Ingress + NetworkPolicy
  data/              PostgreSQL (StatefulSet) + Redis (Deployment)
  monitoring/        Prometheus + Grafana + Alertmanager (kube-prometheus-stack)
```

Per-service K8s resources: Deployment, Service, HPA, PDB, ConfigMap, Secret, ServiceMonitor, NetworkPolicy.

Ingress routes (multi-backend):
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
| Redis | 32Mi | 64Mi |
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
  nestjs-k8s-full.yaml          NestJS + PG + Redis + full monitoring on K8s
  python-k8s-full.yaml          FastAPI + PG + Redis + full monitoring on K8s
  java-k8s-full.yaml            Spring Boot + PG + Redis + full monitoring on K8s
  go-k8s-full.yaml              Gin + PG + Redis + full monitoring on K8s
  polyglot-k8s.yaml             ALL 4 APIs + PG + Redis + monitoring on K8s

  # Docker Compose profiles
  nestjs-docker-full.yaml       NestJS + PG + Redis + ELK + Prometheus on Docker
  python-docker-minimal.yaml    FastAPI + PG only on Docker
  polyglot-docker.yaml          ALL 4 APIs + full stack on Docker

  # VM profiles (via Kamal)
  nestjs-vm.yaml                NestJS + PG + Redis on VM via Kamal
  python-vm.yaml                FastAPI + PG + Redis on VM via Kamal
  java-vm.yaml                  Spring Boot + PG + Redis on VM via Kamal
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
    type: redis
    version: "7"
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
    redis.enabled: true
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
    type: redis                   # Kamal accessory
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
  accessories: [db, redis]         # Kamal manages PG + Redis as Docker containers on VM
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

### 10.5 Deployment CLI

A single command deploys any profile:

```bash
# Deploy a specific profile
./deploy.sh --profile nestjs-k8s-full --target local
./deploy.sh --profile python-docker-minimal
./deploy.sh --profile java-vm --target oci

# Deploy all 4 APIs to K8s (polyglot mode)
./deploy.sh --profile polyglot-k8s --target oci

# Switch which API the ingress routes /api/* to
./deploy.sh switch --backend python

# Tear down
./deploy.sh teardown --profile nestjs-k8s-full

# Status of all deployments
./deploy.sh status
```

Under the hood, `deploy.sh` dispatches to the right tool per topology:

| Topology | What `deploy.sh` Runs |
|----------|-----------------------|
| K8s | `helm upgrade --install todo-app ./infra/helm/umbrella -f <profile-values.yaml>` |
| Docker | `docker compose -f infra/docker/<profile>/docker-compose.yml up -d` |
| VM | `kamal deploy -c infra/kamal/<language>/config/deploy.yml` |
| Serverless | `firebase deploy --only functions,hosting` / `supabase functions deploy` |

**The key insight**: `deploy.sh` is a ~100-line dispatcher, not a deployment engine. The real work is done by Helm, Docker Compose, Kamal, and platform CLIs. The profile YAML just wires the right config to the right tool.

Kamal-specific commands exposed through deploy.sh:
```bash
./deploy.sh --profile nestjs-vm --target oci         # kamal deploy
./deploy.sh rollback --profile nestjs-vm             # kamal rollback
./deploy.sh logs --profile nestjs-vm                 # kamal app logs
./deploy.sh exec --profile nestjs-vm -- bash          # kamal app exec
./deploy.sh accessories --profile nestjs-vm           # kamal accessory details (PG, Redis status)
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
1. SELECT profile    ->  ./deploy.sh --profile java-k8s-full --target local
2. INJECT issue      ->  ./injector.sh inject startup-jvm-slow --profile java-k8s-full
3. OBSERVE symptoms  ->  Grafana dashboard, Slack alert, kubectl events
4. AI AGENT detects  ->  Reads alerts, logs, metrics via APIs
5. AI AGENT resolves ->  Patches readinessProbe.initialDelaySeconds: 30 -> 60
6. VALIDATE fix      ->  ./validator.sh check startup-jvm-slow
7. CLEANUP           ->  ./injector.sh cleanup startup-jvm-slow
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
  steps:
    - action: helm-upgrade
      chart: infra/helm/umbrella
      set:
        api-java.readinessProbe.initialDelaySeconds: 5     # too short for Java
        api-java.readinessProbe.timeoutSeconds: 1
        api-java.livenessProbe.initialDelaySeconds: 10     # also too short

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

| Phase | Focus | Duration | Status |
|-------|-------|----------|--------|
| 0 | New Turborepo monorepo + core extraction | Week 1 | Done |
| 1 | PostgreSQL + Redis integration | Week 2 | Done |
| 2 | K8s topology (Helm umbrella, OCI OKE) + deploy.sh + profiles | Week 3 | Pending |
| 3 | VM via **Kamal** + Docker Compose topologies | Week 3 (parallel) | Pending |
| 4 | Multi-language APIs (Go, Python, Java) + per-language Helm/Kamal configs | Weeks 4-5 | Pending |
| 5 | Serverless adapters (Firebase, Supabase) | Week 6 | Pending |
| 6 | Issue injection system (67 scenarios) + injector/validator CLI | Week 7 | Pending |
| 7 | Monitoring + Sentry + Slack | Week 7 (parallel) | Pending |
| 8 | Multi-VCS + CI/CD (+ optional Dagger for pipeline portability) | Week 8 | Pending |

---

## 13. Success Criteria

- [ ] `turbo run build && turbo run test` passes for all apps/packages (all 4 languages)
- [ ] All 4 APIs return identical responses for the same requests
- [ ] `./deploy.sh --profile nestjs-k8s-full --target local` deploys full stack
- [ ] `./deploy.sh --profile polyglot-k8s --target oci` deploys all 4 APIs to OCI
- [ ] `./deploy.sh --profile nestjs-docker-full` -> all services healthy
- [ ] `./deploy.sh --profile nestjs-vm --target oci` -> Kamal deploys with kamal-proxy + SSL
- [ ] `./deploy.sh switch --backend python` routes /api/* to FastAPI
- [ ] Firebase + Supabase emulators serve CRUD
- [ ] UI backend selector switches between 4 API implementations
- [ ] Grafana Cloud dashboards show metrics from all topologies + all languages
- [ ] Per-language metrics: event loop lag (Node), GC pauses (Java), goroutine count (Go)
- [ ] Sentry captures errors with platform + language tags
- [ ] Slack receives alerts when a service goes down
- [ ] `./injector.sh inject startup-jvm-slow --profile java-k8s-full` -> CrashLoopBackOff -> resolution validated
- [ ] `./injector.sh inject container-python-workers` -> OOMKilled -> resolution validated
- [ ] Push to GitHub -> GitLab + Bitbucket mirrors update
- [ ] `k6` load test populates all dashboards
