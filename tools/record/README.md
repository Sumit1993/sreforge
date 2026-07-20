# `tools/record` — Run record lifecycle management

Tools for managing the canonical `run-record.v1` artifact sets produced by the engine.

## Files

| Path | What |
| --- | --- |
| `migrate-run-records.mjs` | Migrates older camelCase records to the canonical snake_case `run-record.v1` schema. |

## Usage

Operators call this when upgrading the engine to migrate historical runs:

```sh
node tools/record/migrate-run-records.mjs --runs-dir use-cases/booklogr/stacks/flask-compose/runs
```

The migration preserves the exact run identity, scores, and timings but rewrites the on-disk format and schema version. Run with `--dry-run` to preview the changes.
