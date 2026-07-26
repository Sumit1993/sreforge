# `tools/certify` — ADR-0026 scenario certification gate (foundation)

The **hash + schema foundation** the rest of the certification gate builds on.
Merging a new scenario (or use-case) to main requires checked-in, hash-tied
evidence that the full acceptance practice ran — **CI validates the evidence,
the operator's machine pays for producing it** (ADR-0026).

This directory ships the core of ADR-0026 (**shared hash** and **manifest schemas**). The `certify` composite verb, the run-record format, the private `sreforge-runs` store (synced via `tools/record/bank.mjs`), the backfill, and the required CI check build on top of these.

Everything here is **dependency-free** (`node:crypto` + a scoped JSON-Schema
validator) so both `pnpm forge certify` and the offline CI check run with no
install.

## Files

| Path | What |
| --- | --- |
| `surface-hash.mjs` | The ONE shared hashing script (#26). Emits `own_hash` + `shared_hash`; also a compare-vs-manifest mode. |
| `validate-manifest.mjs` | Validate a manifest against its versioned schema (#27). |
| `lib/json-schema-mini.mjs` | Scoped, dependency-free JSON-Schema validator. |
| `schemas/scenario-certification.v1.schema.json` | Per-scenario acceptance manifest (`verify/acceptance.json`). |
| `schemas/substrate-intake.v1.schema.json` | Per-use-case M0 intake manifest (`verify/intake.json`). |
| `schemas/run-record.v1.schema.json` | The canonical snake_case run record schema. |
| `examples/*.example.json` | Samples that validate cleanly against each schema. |
| `test/certify-foundation.test.mjs` | `node:test` — schema validation + hash determinism. |
| `../record/migrate-run-records.mjs` | Migrates older run records to the `run-record.v1` schema. |

The stack's **global-default shared surface** is declared per stack at
`use-cases/<uc>/stacks/<stack>/verify/shared-surface.json`.

## The two hashes (ADR-0026 §2)

- **`own_hash`** — over the scenario-owned surface (`use-cases/<uc>/scenarios/<id>/`
  minus its own `verify/acceptance.json`, plus the stack `scenario.env`, plus the
  scenario's `STORM_SCRIPT` under `<stack>/load/`, plus any per-scenario
  `own_additions`). Mismatch ⇒ **full re-certification**.
- **`shared_hash`** — over the stack's global-default shared surface (arm /
  fault-delivery libs, compose, alert rules — plus the `shared-surface.json` list
  file itself) plus per-scenario `shared_additions`. Mismatch ⇒ append a **fresh
  positive-smoke record** as an addendum (no full re-certification).

Algorithm (`sha256-sorted-file-digests-v1`): `sha256` each file's bytes, build
`<repo-relative-path>\0<filehash>` lines, sort by path, join with `\n`, `sha256`
that. Invariant to filesystem order/mtime; sensitive to any content/rename/add/
delete. A declared path that does not exist is a hard error.

## Usage

```sh
# hashes for a scenario
pnpm certify:hash --use-case booklogr --stack flask-compose --scenario db-pool-exhaustion-deploy

# compare a checked-in manifest to the current tree → action:
#   up-to-date | shared-smoke-addendum | full-recert   (exit 3 on full-recert)
pnpm certify:hash --use-case booklogr --stack flask-compose --scenario db-pool-exhaustion-deploy \
  --manifest use-cases/booklogr/scenarios/db-pool-exhaustion-deploy/verify/acceptance.json

# validate manifests against their schemas
pnpm certify:validate use-cases/booklogr/scenarios/*/verify/acceptance.json

# foundation tests
pnpm test:certify
```

> **Coupling with PR #48 (arm split).** The shared surface includes the arm libs.
> When #48 merges, add `scripts/arm-regress.sh` + `scripts/arm-fire.sh` to each
> stack's `shared-surface.json` (`arm-incident.sh` becomes a thin composer). Do
> the manifest **backfill (#32) after #48 merges** so the shared surface is stable
> when its hashes are computed.
