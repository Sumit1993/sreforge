# `tools/record` — Run record lifecycle management

Tools for managing the canonical `run-record.v1` artifact sets produced by the engine.

## Files

| Path | What |
| --- | --- |
| `bank.mjs` | Content-addressed sync tool for private `sreforge-runs` store (ADR-0026 #28). |
| `is-full-record.mjs` | The public/private boundary predicate. Shared by `bank.mjs` and `tools/record-lint/lint.mjs` so the store and the public repo cannot disagree about what "full" means. |
| `migrate-run-records.mjs` | Migrates older camelCase records to the canonical snake_case `run-record.v1` schema. |

## `bank.mjs` — Private Store Sync Tool

`bank.mjs` syncs full run records and raw campaign evidence into the private content-addressed store (`prismalens/sreforge-runs`).

### CLI Contract

```sh
node tools/record/bank.mjs <record.json | records-dir> [options]
```

| Option | Description |
| --- | --- |
| `--store <path>` | Local clone of `sreforge-runs` (default: `../sreforge-runs`, a sibling of this repo). |
| `--import-all` | Import every `*.json` under `use-cases/**/records/` plus evidence items passed via `--evidence`. |
| `--evidence <path>` | Archive a raw evidence directory or file verbatim under `evidence/<basename>/` (repeatable). |
| `--dry-run` | Print what WOULD be banked (counts + hashes only). No writes, no push. |
| `--no-push` | Commit locally in the store repo but do not `git push`. |

### Root npm/pnpm Scripts

- `pnpm runs:bank <path>` — Bank full records or evidence.
- `pnpm runs:import` — Execute one-time import.
- `pnpm test:bank` — Run `bank.mjs` unit tests.

### Safety Rails

1. **Safety Rail A — Public remote refusal**: Refuses to run if `--store` remote origin is not `sreforge-runs` or if store path is inside the public `sreforge` repository.
2. **Safety Rail B — Runtime privacy assertion**: Asserts that `sreforge-runs` GitHub repository visibility is `PRIVATE` before writing or pushing.
3. **Safety Rail C — Zero content leaks**: Logs only derived metadata (`run_id`, `scenario_id`, `sha256`, byte count, action); never logs transcript, diff, or evidence bodies.

These three guard the *private store*. The matching guard on the *public repo* side is `pnpm record-lint` (`tools/record-lint/`, CI-required), which fails if any git-tracked record under `use-cases/` carries transcript content. Both halves share `is-full-record.mjs`; without the lint, `bank.mjs` refusing a pruned record and nothing refusing a full one left the boundary enforced in one direction only.

### Store Layout (`sreforge-runs`)

- `records/<sha256>.json` — Full records, content-addressed. Filename = `full_record_sha256`.
- `evidence/<campaign-id>/...` — Raw campaign evidence logs archived verbatim.
- `index.json` — Append-only JSON array mapping metadata to `sha256` and file path.

## Usage — `migrate-run-records.mjs`

Operators call this when upgrading the engine to migrate historical runs:

```sh
node tools/record/migrate-run-records.mjs --runs-dir use-cases/booklogr/stacks/flask-compose/runs
```

The migration preserves the exact run identity, scores, and timings but rewrites the on-disk format and schema version. Run with `--dry-run` to preview the changes.
