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

# Phase 2 Spec — Synthetic history generator

> Implementation-ready spec for Phase 2 of [TEST-ENV-PLAN.md](TEST-ENV-PLAN.md). Builds the `tools/gen-history.ts` script and accompanying message corpora used by Phase 3 to seed believable git history into the new agent-visible repos.

## Goal

Produce a reusable script that, given:

- A target git repo containing the desired final file tree
- A persona identity (from `tools/personas.json`)
- A date range and a target commit count
- A message corpus file matching the repo's domain (backend/frontend/infra)

…rewrites the repo's history so the final tree is reached via N believable commits spread over the date range, authored by the persona. The final working tree after the script runs matches the input working tree byte-for-byte.

Determinism is opt-in via `--seed` so that runs are reproducible during development.

## Preconditions

| Check | Command | Expected |
|---|---|---|
| Phase 1 complete | `test -f /home/sumit/sources/todo-app/prismalens-agents-harness/tools/personas.json && echo ok` | `ok` |
| Node 22+ | `node --version` | `v22.x` or higher |
| pnpm available | `pnpm --version` | non-error |
| `git` available | `git --version` | non-error |

## Inputs

- `HARNESS_PATH = /home/sumit/sources/todo-app/prismalens-agents-harness`
- All work happens inside `HARNESS_PATH/tools/`.

## Deliverables

| Path | Purpose |
|---|---|
| `tools/gen-history.ts` | Main generator |
| `tools/lib/scheduler.ts` | Date-slot allocation (separated for testability) |
| `tools/lib/bucketer.ts` | File-bucket allocation (separated for testability) |
| `tools/lib/message-picker.ts` | Corpus-loading and message-rendering (separated for testability) |
| `tools/lib/domains.ts` | Domain word pools per corpus type |
| `tools/messages/backend.txt` | ~80 commit messages for NestJS/API repos |
| `tools/messages/frontend.txt` | ~80 commit messages for Next.js/UI repos |
| `tools/messages/infra.txt` | ~50 commit messages for Helm/Prometheus repos |
| `tools/__tests__/scheduler.test.ts` | Vitest tests |
| `tools/__tests__/bucketer.test.ts` | Vitest tests |
| `tools/__tests__/message-picker.test.ts` | Vitest tests |
| `tools/package.json` | Local package (vitest + tsx + commander/yargs) |
| `tools/tsconfig.json` | Local tsconfig |
| `tools/README.md` | Usage docs |

Top-level: no changes to root `package.json` for v1 — `tools/` is self-contained.

## CLI signature

```
pnpm --filter tools tsx gen-history.ts \
  --target <path>           # required, absolute path to target repo (must be a git repo)
  --persona <key>           # required, must exist in tools/personas.json (arjun|priya|sre)
  --start-date <YYYY-MM-DD> # required, ISO date
  --end-date <YYYY-MM-DD>   # required, ISO date, must be after start-date
  --count <N>               # required, integer 10..1000
  --corpus <path>           # required, path to a corpus file (typically tools/messages/<type>.txt)
  [--seed <N>]              # optional, integer; without it, generator is non-deterministic
  [--dry-run]               # optional; prints planned commits without writing them
  [--force]                 # optional; required if target has any commits beyond initial seed
```

Exit codes:

- 0: success
- 2: input validation error
- 3: target repo state invalid (not a git repo, has uncommitted changes, has commits without `--force`)
- 4: corpus file unreadable or empty after stripping comments
- 5: persona key not found in personas.json
- 99: unexpected error (stack trace to stderr)

Persona key `sumit` is rejected with exit 5 explanatory message: "the `sumit` persona has no synthetic commits — used for admin issues only".

## Persona resolution

Reads `<HARNESS_PATH>/tools/personas.json` (or path relative via env var `PRISMALENS_HARNESS=<path>`):

```json
{
  "arjun": { "name": "Arjun Menon", "email": "arjun.menon@labs.prismalens.io" },
  "priya": { "name": "Priya Shah",  "email": "priya.shah@labs.prismalens.io" },
  "sre":   { "name": "SRE",         "email": "sre@labs.prismalens.io" },
  "sumit": { "name": "Sumit Patel", "email": "(real email)" }
}
```

`--persona arjun` resolves to that record. Used to set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` for each commit.

## Corpus file format

Plain UTF-8 text. Rules:

- Lines starting with `#` are comments and skipped.
- Empty lines are skipped.
- All other lines are message templates.
- Template variables:
  - `{file}` — representative file path from the commit's bucket
  - `{domain}` — domain word from `tools/lib/domains.ts`

Example `backend.txt` fragment:

```
# Standard feat/fix/chore distribution. Lowercase, terse.
feat({domain}): add basic CRUD endpoints
feat({domain}): wire up validation pipe
fix({domain}): handle null parent id in update
fix({domain}): retry transient connection errors
chore: bump @nestjs/common to latest
chore: format with prettier
refactor: extract {file} into its own module
test({domain}): add e2e coverage for delete path
docs: note expected env vars in README
style: drop trailing spaces
perf({domain}): index user_id for list query
revert: previous {domain} change broke staging
hotfix: roll back broken migration
fix: typo in error message
chore: rerun ci
```

The corpus is deliberately lowercase, terse, includes filler / typo entries for realism.

### Three corpus seed files

**`tools/messages/backend.txt`** — domain pool: `todos`, `auth`, `cache`, `db`, `metrics`, `health`, `webhook`, `worker`. Seed with the above example, expand to 80 lines.

**`tools/messages/frontend.txt`** — domain pool: `header`, `list`, `form`, `theme`, `nav`, `auth`, `dashboard`. Sample:

```
feat({domain}): swap in radix dialog
fix({domain}): clear stale react query cache on logout
chore: bump next to 15.2.8
refactor: pull {file} into a hook
style: tailwind class order
fix: dark mode contrast on disabled buttons
docs: README quick-start
chore: prettier
```

Expand to 80 lines.

**`tools/messages/infra.txt`** — domain pool: `helm`, `prometheus`, `grafana`, `loki`, `alert`, `dashboard`. Sample:

```
feat({domain}): add p99 latency alert
fix({domain}): bump scrape interval to 30s
chore: update helm chart version
refactor: split values.yaml per env
docs: runbook for {domain} incidents
fix: dashboard panel title typo
```

Expand to 50 lines.

## Algorithm

### Phase A — Validate inputs

1. Parse CLI args; reject with exit 2 on malformed input.
2. Resolve `--target` to absolute path. Verify it's a git repo, has zero or only-initial-commit state OR `--force` is set, has clean working tree.
3. Resolve `--corpus` to absolute path; load and strip; reject if empty.
4. Resolve `--persona` against `tools/personas.json`; reject `sumit`.
5. Parse dates as ISO UTC; reject if `end <= start`.
6. Verify `10 <= count <= 1000`.

### Phase B — Snapshot the target tree

1. Read all files (excluding `.git/` and gitignored paths).
2. Build path → byte-content list.
3. The "final state" is this snapshot.

### Phase C — Bucket files into commits

1. Classify each file into a category by path pattern:
   - `core`: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `eslint.config.*`, `nest-cli.json`, `next.config.*`, `Dockerfile`, `prisma/schema.prisma`
   - `source`: under `src/`, `lib/`, `app/`, `pages/` (excluding tests)
   - `test`: under `test/`, `tests/`, `__tests__/`, or matching `*.spec.*`, `*.test.*`
   - `infra`: under `helm/`, `k8s/`, `prometheus/`, `grafana/`, `loki/`, `kamal/`
   - `docs`: `*.md` outside repo root, anything under `docs/`
   - `other`: everything else

2. Allocate commit slots to categories (round to integers; leftovers to `source`):

| Category | % of commits |
|---|---|
| core | 5 |
| source | 60 |
| test | 15 |
| infra | 10 |
| docs | 8 |
| other | 2 |

3. Order commits by category — first 5% `core`, next 60% `source` (intermixed), remainder `test`/`infra`/`docs`/`other` sprinkled.
4. Assign 1-N files per commit (ceiling of `categoryFileCount / categorySlotCount`).
5. If a category has fewer files than its slots, donate spares to `source`.

### Phase D — Generate date slots

In `tools/lib/scheduler.ts`:

1. Compute total seconds between start and end.
2. Even-distribute `count` slots, then apply jitter (± gap/2).
3. Snap each weekend slot to Friday/Monday with 80% probability.
4. Time of day biased to business hours: `9 + random(0,9)` hour, random(0,60) minute, `random(1,59)` second (non-zero to avoid the all-whole-seconds tell).
5. With 5% probability per `count`, mark slot as "Friday burst" — emit 3-5 sub-slots in the 2 hours after.
6. With 3% probability per `count`, mark as "weekend hotfix" — force Sat/Sun with `hotfix`-prefixed message.
7. Sort ascending.

### Phase E — Render and apply commits

Per slot in chronological order:

1. Pick a message template (uniform random, or filtered to `hotfix:`/`fix:` for hotfix slots).
2. Substitute `{file}` and `{domain}`.
3. Build git env:
   ```
   GIT_AUTHOR_NAME=<persona.name>
   GIT_AUTHOR_EMAIL=<persona.email>
   GIT_AUTHOR_DATE=<slot ISO 8601>
   GIT_COMMITTER_NAME=<persona.name>
   GIT_COMMITTER_EMAIL=<persona.email>
   GIT_COMMITTER_DATE=<slot ISO 8601>
   ```
4. Write the bucket files to working tree (only those files; previous commits' files already present).
5. `git add <bucket files>`
6. `git commit -m "<rendered message>"`

Setup requires wiping the repo before starting:

```
# Setup
- Capture snapshot (Phase B)
- Wipe working tree
- rm -rf .git && git init -b main

# Loop
for slot, bucket, message in zip(slots, buckets, messages):
    for file in bucket:
        write_file(file, snapshot[file])
    git_add(bucket)
    git_commit_with_env(message, slot, persona)

# Final assertion
assert working_tree_matches(snapshot)
```

### Phase F — Verify

1. `git log --oneline | wc -l` equals `count`.
2. `git log --format=%ae | sort -u` returns exactly one email (the persona's).
3. `git log --format=%ad --date=iso8601-strict | awk '{print $1}' | sort -u | wc -l` > 50% of `count` (commits spread across enough distinct days).
4. `git status --porcelain` empty.
5. Working tree matches snapshot byte-for-byte.

Failure → exit 99 with the failing assertion in stderr.

## Dry-run behavior

`--dry-run`: phases A-D run; Phase E prints `<slot ISO>  <persona>  <message>  <bucket size>` per row to stdout. Nothing written. Exit 0.

## Testing strategy

Three vitest files. Run with `pnpm --filter tools test`.

### `tools/__tests__/scheduler.test.ts`

- `generates exactly N slots within the date range`
- `slots are sorted ascending`
- `with --seed, two runs produce identical sequences`
- `at least 60% of slots fall on weekdays (Mon-Fri)`
- `slot seconds are never 0`
- `Friday-burst sub-slots are within 2 hours of each other`

### `tools/__tests__/bucketer.test.ts`

- `every input file lands in exactly one bucket`
- `categories receive approximately their target proportion ±2`
- `core-category buckets appear in the first 10% of commits`
- `with --seed, identical bucket assignments`

### `tools/__tests__/message-picker.test.ts`

- `loads a corpus file and strips comments`
- `picks only hotfix/fix lines when context is "hotfix"`
- `substitutes {file} and {domain} placeholders correctly`
- `errors when corpus is empty after stripping`

## DoD (rollup)

```bash
cd /home/sumit/sources/todo-app/prismalens-agents-harness

# Files exist
test -f tools/gen-history.ts && \
test -f tools/lib/scheduler.ts && \
test -f tools/lib/bucketer.ts && \
test -f tools/lib/message-picker.ts && \
test -f tools/messages/backend.txt && \
test -f tools/messages/frontend.txt && \
test -f tools/messages/infra.txt && echo ok

# CLI help works
pnpm --filter tools tsx gen-history.ts --help                               # exits 0

# Tests pass
pnpm --filter tools test                                                    # all green

# Dry-run on a throwaway repo works
mkdir /tmp/gen-test && cd /tmp/gen-test && git init -b main && \
  echo "hi" > README.md && git add . && \
  GIT_AUTHOR_NAME=x GIT_AUTHOR_EMAIL=x@x git commit -m init && \
  cd /home/sumit/sources/todo-app/prismalens-agents-harness && \
  pnpm --filter tools tsx gen-history.ts \
    --target /tmp/gen-test --persona arjun \
    --start-date 2025-01-01 --end-date 2025-06-01 \
    --count 20 --corpus tools/messages/backend.txt \
    --dry-run --force                                                       # exits 0

# Real run on the throwaway lands cleanly
pnpm --filter tools tsx gen-history.ts \
  --target /tmp/gen-test --persona arjun \
  --start-date 2025-01-01 --end-date 2025-06-01 \
  --count 20 --corpus tools/messages/backend.txt \
  --seed 42 --force                                                         # exits 0
cd /tmp/gen-test && \
  test "$(git log --oneline | wc -l)" = "20" && \
  test "$(git log --format=%ae | sort -u | wc -l)" = "1" && \
  test "$(git log --format=%ae | head -1)" = "arjun.menon@labs.prismalens.io" && echo ok
```

If all return as expected, Phase 2 is done.

## Idempotency notes

- Destructive on the target repo (wipes `.git/`). The `--force` flag exists to require explicit acknowledgement.
- With `--seed`, output is byte-reproducible.

## Out of scope for Phase 2

- File-modification commits (only-add for v1).
- Rename commits.
- Merge commits / multi-branch history.
- GitHub Issues / PRs (covered in Phase 3 spec).
- Quiet-stretch pattern (declined for v1; bump in a follow-up regen if history feels uniform).

## Escalation triggers

- Persona JSON malformed.
- After Phase E, working tree doesn't match snapshot — generator bug.
- Target's existing commit count exceeds 1 even with `--force` — surface and ask for confirmation.
