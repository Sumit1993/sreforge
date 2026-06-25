# booklogr rig scripts

These scripts bring up the rig and run one graded incident. They run in a fixed
**phase sequence**; most are **entry-points** you invoke, a few are **sub-steps**
called by an orchestrator, and two are **sourced helpers**. The flat directory
hides that structure — this file (and the `Taskfile.yml` one level up) restores it.

> None of these are visible to the agent. The agent clones `substrate/booklogr`
> into `.run-workspace/booklogr`; `scripts/` is a sibling and never enters
> `/workspace`. So this is purely operator ergonomics — reorganise freely.

## Run via Task (recommended)

The lifecycle is wired as a runnable table-of-contents in `../Taskfile.yml`
([go-task](https://taskfile.dev)). `task` is a **pinned devDependency**
(`@go-task/cli` in the root `package.json`), not a global install — so run
`pnpm install` once at the repo root, then drive it via pnpm (the local binary
isn't on PATH from this subdir):

```sh
pnpm booklogr              # the menu, in phase order  (alias for `task --dir <this stack>`)
pnpm booklogr setup        # once:    import substrate + author regression
pnpm booklogr up           # session: bring up the deploy plane
pnpm booklogr arm          # run:     reset to baseline, start storm, confirm alert fires
pnpm booklogr agent        # run:     clean /workspace clone + bring up the sandbox
pnpm booklogr run          # run:     drive the incident end-to-end  (RUNNER=external for the real-agent loop)
pnpm booklogr verify       # any:     boundary + de-tell + alert-pickup probes, in PARALLEL
pnpm booklogr down         # end:     tear down deploy + load planes
pnpm booklogr smoke        # CI:      positive (reference fix passes) + negative (anti-cheat holds)

# For task flags (dry-run / watch / list), call the binary directly:
pnpm exec task --dir use-cases/booklogr/stacks/flask-compose -n run     # -n = dry-run
```

Two things the runner adds over bare scripts: `build-core` is **skipped when
core's sources are unchanged** (change-detection), and `verify` runs its three
probes **concurrently** (parallelism). The root `package.json` allowlists
`@go-task/cli` under `pnpm.onlyBuiltDependencies` so its install step (which
downloads the Task binary) is permitted under pnpm's default script blocking.

## Phase order & roles

| Phase | When | Entry-point | Sub-step (called by ↑) | Helper |
|---|---|---|---|---|
| **build** | on `run` | — | `run-incident.mjs` builds via `core/` | — |
| **setup** | once | `import-substrate.sh`, `inject-regression.sh` | | |
| **bring-up** | per session | `up.sh` | | |
| **arm** | per run | `arm-incident.sh` | `confirm-fire.mjs` | |
| **agent** | per run | `prepare-agent-workspace.sh` | | |
| **run** | per run | `run-incident.mjs` | `warm-cache.sh` (readiness gate) | |
| **verify** | any time | `verify-boundary.sh`, `verify-alert-pickup.sh`, `verify-detell.sh`, `verify-clear.mjs` | | |
| **teardown** | end | `down.sh` | | |
| **smoke** | CI/e2e | `smoke-positive.sh`, `smoke-negative.sh` | (each re-arms, then runs) | |
| **diag** | any time | `status.mjs` | | |
| **—** | — | | | `lib-deploy.sh`, `lib.mjs` (sourced, never run directly) |

`fixtures/no-op-fix.patch` is data (the deliberately-wrong fix the negative smoke
asserts against), not a script.

## Run standalone

Every script self-resolves its own paths, so you can still run any of them directly
from anywhere, e.g. `bash scripts/arm-incident.sh`. The one thing the Task runner
does for you that you must do by hand standalone: **load `.env`** before
`run-incident.mjs` (it reads `GITEA_TOKEN` etc. from the environment):

```sh
set -a; . ./.env; set +a
node scripts/run-incident.mjs --run-id my-run        # RUNNER=external for the real agent
```

The `smoke-*.sh` scripts already source `.env` themselves, so they need no setup.

## When use-cases multiply

This `Taskfile.yml` is stack-local on purpose. If/when there are more use-cases, a
root `Taskfile.yml` can pull each stack's file in with `includes:` (e.g.
`booklogr: use-cases/booklogr/stacks/flask-compose`), so `task booklogr:run` works
from the repo root without changing anything here. That's also the natural seam to
add a repo-wide build/check graph (Turborepo/Nx) for the *build* layer, separate
from this *lifecycle* layer.
