---
type: playbook
tags: [todo-app/patterns]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Extension recipes

> Copy-pasteable step lists for adding new services, topologies, or scenarios. Each recipe assumes Phase 1-4 are complete.

## Recipe 1 — Add a new service (language/runtime)

Example: add a Python worker service.

### Steps

1. **Pick a persona** — add to `tools/personas.json` and `internal-docs/personas.md`. Example: `dev3 = "Maya Iyer" <maya.iyer@labs.prismalens.io>`. Update the persona's `Repos` column to include the new service repo name.

2. **Scaffold the service fresh** — don't carry over stubs from `apps/`. Use the current best-practice scaffolder for the language:
   ```bash
   # Example for Python with FastAPI + Poetry
   mkdir /tmp/todo-worker && cd /tmp/todo-worker
   poetry init --no-interaction
   poetry add fastapi uvicorn prometheus-fastapi-instrumentator
   # ... build out the service ...
   ```

3. **Create the GitHub repo**:
   ```bash
   gh repo create prismalens-labs/todo-worker --public \
     --description "Background worker for todo platform — Python + FastAPI" \
     --add-readme=false
   ```

4. **Move content + push initial commit by the persona**:
   ```bash
   cd /home/sumit/sources/todo-app
   gh repo clone prismalens-labs/todo-worker
   cp -r /tmp/todo-worker/* todo-worker/
   cd todo-worker
   git config user.name "Maya Iyer"
   git config user.email "maya.iyer@labs.prismalens.io"
   git add .
   GIT_AUTHOR_DATE=2026-04-01T10:00:00 git commit -m "initial commit — todo worker skeleton"
   git push origin main
   ```

5. **Write a corpus file** at `tools/messages/python-backend.txt` (~80 lines, Python idiom — `feat({domain}): add task X`, `chore: ruff format`, etc.). Add domain pool to `tools/lib/domains.ts`.

6. **Run synthetic history**:
   ```bash
   cd /home/sumit/sources/todo-app/prismalens-agents-harness
   pnpm --filter tools tsx gen-history.ts \
     --target ../todo-worker \
     --persona dev3 \
     --start-date 2026-04-01 --end-date 2026-05-15 \
     --count 30 \
     --corpus tools/messages/python-backend.txt \
     --force
   cd ../todo-worker
   git push --force-with-lease origin main
   ```

7. **Add to the Compose stack**: edit `prismalens-labs/infra-docker/docker-compose.yml`, add a service block:
   ```yaml
   todo-worker:
     build: ../todo-worker
     environment:
       DATABASE_URL: postgresql://todo:${POSTGRES_PASSWORD}@postgres:5432/tododb
     depends_on:
       postgres: { condition: service_healthy }
   ```

8. **Update the JSON contract** in `harness/env-config.yaml` to include the worker URL/port.

9. **Apply branch protection**:
   ```bash
   gh api -X PUT "repos/prismalens-labs/todo-worker/branches/main/protection" \
     <same flags as branch-protection.md>
   ```

10. **Fork for the agent**:
    ```bash
    gh repo fork prismalens-labs/todo-worker --org prismalens-labs-agent --clone=false --remote=false
    ```

11. **Update `internal-docs/roadmap.md`** to mark "Python worker service" as done.

Approximately half a day of work.

---

## Recipe 2 — Add a new topology

Example: activate `infra-k8s` (live K8s cluster instead of parked).

### Steps

1. **Provision a K8s cluster** — k3d, kind, minikube for local; EKS/GKE for cloud. Save the kubeconfig.

2. **Audit `prismalens-labs/infra-k8s` content** — make sure the Helm charts compile against current K8s version. Update if needed (committed by `sre` persona).

3. **Build images** — either local registry (k3d --registry-create) or push to GHCR. Update `prismalens-labs/infra-k8s/helm/*/values.yaml` image references.

4. **Refactor `scripts/setup.sh` dispatcher** to support per-topology setup:
   ```bash
   topology=$(yq '.deployment_kind' "$config")
   case "$topology" in
     local-docker) "$(dirname "$0")/topology/docker/setup.sh" ;;
     local-k8s)    "$(dirname "$0")/topology/k8s/setup.sh" ;;
     *) echo "unknown topology: $topology" >&2; exit 2 ;;
   esac
   ```
   Create `scripts/topology/docker/setup.sh` (the current dispatcher logic) and `scripts/topology/k8s/setup.sh`.

5. **Per-topology env config**: `harness/env-config.k8s.yaml` overrides URLs (e.g., grafana on a NodePort or Ingress).

6. **Add scenario-specific topology hooks**: if a scenario only makes sense on one topology, scope it via scenario YAML:
   ```yaml
   topologies: [local-k8s]   # not [local-docker, local-k8s]
   ```

7. **Update `internal-docs/eval-contract.md`** if the JSON contract grows new fields for K8s (e.g., pod names, namespace).

Approximately 1-2 days of work, mostly cluster provisioning + image building.

---

## Recipe 3 — Add a new scenario

Example: add a `cache-stampede-oom` scenario that triggers BUG #3 (closure-captured cache).

### Steps

1. **Write `scenarios/cache-stampede-oom.yaml`**:
   ```yaml
   id: cache-stampede-oom
   description: |
     A burst of writes to many distinct cache keys (e.g., 1500 unique GET /todos/<id>
     requests with cache-bust query params) trips the recreateCacheIfNeeded path,
     which reassigns this.requestCache. The cleanup interval still references the
     old Map, leaking memory. Container memory grows until OOM-kill.

   trigger:
     type: external-load
     target: "http://localhost:3000/todos/{int}?_bust={uuid}"
     method: GET
     rps: 30
     duration_seconds: 1200

   expected_alerts:
     - name: ContainerMemoryHigh
       fires_within_seconds: 900

   reset:
     type: restart-container
     services: [todo-api]
   ```

2. **Create `scripts/scenarios/cache-stampede-oom/{setup,teardown,verify}.sh`** following the `latency-retry-storm` pattern.

3. **Add the new Prometheus alert** `ContainerMemoryHigh` to `prismalens-labs/infra-docker/prometheus/rules/alerts.yml`:
   ```yaml
   - alert: ContainerMemoryHigh
     expr: container_memory_usage_bytes{name="todo-api"} > 400e6
     for: 2m
     labels: { severity: critical }
     annotations:
       summary: "todo-api container memory > 400MB"
       runbookUrl: "https://github.com/prismalens-labs/platform-runbooks/blob/main/general-investigation.md"
   ```

4. **Optionally author a scenario-specific runbook** at `prismalens-labs/platform-runbooks/memory-leak.md` and update `runbookUrl`. Or rely on the generic runbook.

5. **Test it**: smoke-test the same way as Phase 4 Task 4.12.

6. **Update `internal-docs/roadmap.md`** — mark the scenario as available.

Approximately 1 day of work for a well-shaped scenario.

---

## Anti-patterns to avoid

- **Don't add a scenario without an alert.** If the scenario's symptom isn't observable via Prometheus, the agent can't find it. Add the alert first.
- **Don't share Prisma migrations or `@todo-app/*` packages across services** in extensions. Each service owns its own schema/types. Polyrepo means polyrepo.
- **Don't commit scenario-specific logic into `prismalens-labs/*`.** The harness keeps scenarios in `scripts/scenarios/<id>/`. The agent-visible repos contain only the code/config the bug lives in.
- **Don't skip persona assignment.** New services without a persona end up with commits from whoever ran `gen-history.ts` first — a forensic tell.
