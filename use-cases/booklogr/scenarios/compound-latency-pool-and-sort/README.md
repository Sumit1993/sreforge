# compound-latency-pool-and-sort

An `incident`-profile compound scenario on the `booklogr` / `flask-compose` stack.

**Incident (one line):** Two independent performance regressions across two separate commits (an older DB connection pool restriction and a recent in-memory full-library sort) combine to breach the 300 ms p99 latency SLO; reverting either commit alone leaves the alert firing.

## Why this scenario exists

Every single-fault scenario on `booklogr` is saturated by standard agent heuristics (look for the single recent deploy, revert it). This scenario breaks that heuristic by deploying **two independent, independently-sufficient faults** delivered as **two separate commits** with different authors and timestamps. The recent-culprit heuristic finds and reverts only the newest commit — and the alert **stays firing**, because the older commit alone still breaches the SLO. Only reverting **both** clears the alert.

## The Revert Table

| State | Cause 1 (pool+gthread) | Cause 2 (Python sort) | p99 vs 0.3 s SLO | Alert |
|---|---|---|---|---|
| **Armed** | on | on | ≫ 0.3 s (both bottlenecks stacked) | **FIRING** |
| Revert Cause 2 only (revert the *recent* hot diff) | on | off | **> 0.3 s** — Cause 1 alone is sufficient (proven at RATE≥25) | **STILL FIRING** |
| Revert Cause 1 only (revert the *older* config commit) | off | on | **> 0.3 s** — Cause 2 alone is sufficient (proven at RATE=50) | **STILL FIRING** |
| Revert both | off | off | healthy baseline (measured 0.247 s at cold-arm, threshold 0.3 s) | **CLEAR** |

## CERTIFICATION PENDING (ADR-0026)

This scenario is newly authored and awaiting physics certification under ADR-0026. Certified headroom records, fire timing benchmarks, and acceptance verification artifacts will be generated during the certification run.

## Layout

| File | Purpose |
| --- | --- |
| `scenario.toml` | Machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/fault-1-config.patch` | Cause 1 patch: DB pool reduction + gthread workers (older commit) |
| `inject/fault-2-sort.patch` | Cause 2 patch: In-memory full-library sort + unicode normalization (recent commit) |
| `inject/README.md` | Fault delivery mechanism documentation (mode `arm-deploy-recent-compound`) |
| `inject/triage.jsonl` | Symptom-level operator chatter for triage bundle |
| `solution/fix.patch` | Canonical reference fix (reverts BOTH commits) |
| `solution/reference-fix.md` | Detailed root-cause breakdown and fix family rationale |
| `verify/oracle.md` | v1 mitigation-oracle specification |

The stack itself lives at `../../stacks/flask-compose/`.

## Run it end to end

Before running this scenario for the first time, you must create its local anchor base:

```bash
bash scripts/prepare-scenario.sh compound-latency-pool-and-sort
```

The full automated loop — arm the incident (regress + storm + confirm-fire), drive a reference fix through the engine, then reset — is run from the stack dir:

```bash
SCENARIO_ID=compound-latency-pool-and-sort pnpm forge arm booklogr
SCENARIO_ID=compound-latency-pool-and-sort pnpm forge run booklogr
```

## Inspect the running stack

| Resource | URL |
| --- | --- |
| booklogr API | http://localhost:5000 |
| booklogr web | http://localhost:5150 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3002 |

> API metrics are exported on a dedicated port (`booklogr-api:9090`) by prometheus-flask-exporter in multiprocess mode.
