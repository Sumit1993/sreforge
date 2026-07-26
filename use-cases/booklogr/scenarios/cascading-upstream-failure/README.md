# cascading-upstream-failure

An `incident`-profile scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** A schema-cleanup deploy drops the composite index backing the default library listing, causing full seq-scans and top-N sorts on every request that saturate CPU and drive p99 latency above 300ms, firing `BooklogrApiLatencyP99High`. The fix must restore the index.

## CERTIFICATION PENDING (ADR-0026)

Ships authored, NOT certified. Numbers tagged `# TUNE-ON-CERT` are design targets, not measurements. Required live evidence before this scenario counts toward any A/B verdict:

1. **Determinism soak** — `BooklogrApiLatencyP99High` fires under the storm within 240s, repeatably.
2. **2 cold arms** — two independent cold arm→confirm-fire runs, both firing.
3. **Solvability** — the roll-forward `solution/fix.patch` drives the mitigation oracle to ≥ 0.85 under still-active load.
4. **Anti-cheat negative** — a load-stopping / brief-clear fix scores < 0.85 (ADR-0004); and a **file-revert** of the drop migration fails closed — capture that as an explicit negative.
5. **De-tell judge** — t0 bundle (alert + triage) leaks no root cause; confirm storm-script comment is outside the agent clone.
6. **≥ 1 graded agent attempt** — one real agent run graded end-to-end.
7. **#64 headroom** — `verify/headroom.md` reads `QUALIFIED`.
8. **Lever calibration** — final `SEED_COUNT`/`RATE` recorded; healthy indexed p99 and faulted seq-scan p99 both measured and written to `verify/headroom.md` + `verify/acceptance.json`.
9. **Index-use proof** — `EXPLAIN (ANALYZE)` shows `Index Scan using ix_books_owner_lower_title` for the healthy hot query and `Seq Scan` + `Sort` under the fault, at the chosen `SEED_COUNT`.
10. **Anchor coherence + CI presence** — the `prepare-scenario.sh` anchor's migration head is the baseline index revision; fault patch applies cleanly on top.
11. **Shared-surface + recalibration** — db-pool/#65/others re-measured and faults re-confirmed with the index in the substrate.
12. **Alembic linearity** — after fault then fix, `flask db heads` shows a single head; no dangling/branched revisions.

## Layout

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `scenario.toml`               | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/fault.patch`          | the actual patch to apply at arm time to inject the issue          |
| `solution/fix.patch`          | canonical reference fix (roll-forward restoring the index)  |
| `verify/oracle.md`            | v1 mitigation-oracle spec (CompoundedOracle contract)              |

The stack itself lives at `../../stacks/flask-compose/`.

## Run it end to end

Before running this scenario for the first time, you must create its local anchor base:

```bash
bash scripts/prepare-scenario.sh cascading-upstream-failure
```

The full automated loop runs in two phases from the stack dir — first `arm` the
incident (regress + storm + confirm-fire), then `run`, which drives a scripted
reference fix through the engine (CI gate → auto-merge → redeploy → behavioral
oracle under still-active load):

```bash
SCENARIO_ID=cascading-upstream-failure pnpm forge arm booklogr
SCENARIO_ID=cascading-upstream-failure pnpm forge run booklogr
```

## Inspect the running stack

| Resource     | URL                       |
| ------------ | ------------------------- |
| booklogr API | http://localhost:5000     |
| booklogr web | http://localhost:5150     |
| Prometheus   | http://localhost:9090     |
| Alertmanager | http://localhost:9093     |
| Grafana      | http://localhost:3002     |

> API metrics are exported on a dedicated port (`booklogr-api:9090`) by the
> prometheus-flask-exporter in multiprocess mode — they are not on `:5000/metrics`.

## Storm/triage opt-ins

Storm load and triage feed can be manually triggered with:
```bash
STORM_SCRIPT=booklogr-storm-shelf.js
RATE=50 # TUNE-ON-CERT
SEED_COUNT=300000 # TUNE-ON-CERT
TRIAGE_FEED=inject/triage.jsonl
READINESS_GATE=on
```
