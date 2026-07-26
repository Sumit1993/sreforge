# worker-cpu-starvation

An `incident`-profile scenario on the `booklogr` / `flask-compose` stack. The
first **structurally-hard** scenario: a multi-service **alert storm** that a
solver must group into ONE incident with a shared cause.

**Incident (one line):** A recent deploy changed the `/v1/books` library-list
route to re-sort the whole library in the application on every request; under the
read storm this CPU-starves all four Gunicorn workers, every endpoint queues, p99
breaches the 300 ms SLO and fires `BooklogrApiLatencyP99High` — and because the
starved API stops driving its normal call volume to the book-metadata provider,
a second, cross-service signal fires on `service: book-metadata`. The fix must
stop the per-request full-library re-sort.

The agent is paged with the firing alert — the engine's `ContextAssembler`
renders the neutral incident brief from the alert plus the live endpoints (and
the symptom-level triage feed) — then investigates the live stack and submits a
fix via `submit`. The harness builds + redeploys it, then the
[mitigation oracle](verify/oracle.md) scores whether the alert clears and stays
cleared **under still-active load**.

## Layout

| File                        | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `scenario.toml`             | machine-readable manifest (profile, expected alert, timing, paths, inject, verify) |
| `inject/fault.patch`        | the organic regression applied at arm time (single file: `api/routes/books.py`)  |
| `inject/triage.jsonl`       | symptom-level operator chatter delivered in the t0 bundle                         |
| `inject/README.md`          | delivery-mechanism pointer                                                        |
| `solution/fix.patch`        | canonical reference fix (the exact revert)                                        |
| `solution/reference-fix.md` | root cause, fix, and acceptable fix families                                      |
| `verify/oracle.md`          | v1 mitigation-oracle spec (CompoundedOracle contract) + storm-propagation physics |

The stack itself lives at `../../stacks/flask-compose/`. This scenario's
stack-side `scenario.env` is at
`../../stacks/flask-compose/scenarios/worker-cpu-starvation/scenario.env`.

## Run it end to end

Before running this scenario for the first time, you must create its local anchor
base:

```bash
bash scripts/prepare-scenario.sh worker-cpu-starvation
```

Then, from the stack dir:

```bash
SCENARIO_ID=worker-cpu-starvation pnpm forge arm booklogr
SCENARIO_ID=worker-cpu-starvation pnpm forge run booklogr
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
> The book-metadata provider exposes its own harness metrics on
> `book-metadata:8080/metrics` (scraped internally over the compose network).

## Storm and triage opt-ins

- **Storm:** `STORM_SCRIPT=booklogr-storm-browse-mixed.js`, `RATE=50`. A dominant
  uncached `/v1/books` library-read stream (the CPU-saturating path) plus a
  low-rate, uncached book-detail stream that routes through the book-metadata
  provider (the cross-service coupling — kept under ~1 % of volume so it does not
  move the healthy-baseline p99). See the script header for the physics.
- **Storm capture:** `WEBHOOK_STORM_WINDOW_S=180` groups the co-firing alerts into
  one delivery at t0 (raised from 30 at cert: the coupled book-metadata alert
  reaches firing ~2m20s after storm resume — its rule holds a `for: 2m`).
- **Triage:** `TRIAGE_FEED` points at `inject/triage.jsonl` — symptom-level
  chatter that passes the t0-bundle `assertSymptomLevel` guard.
- **Readiness gate:** `READINESS_GATE=on` (the storm never lets up; the rollout
  drains it, waits healthy, resumes under still-active load — ADR-0004 preserved).

## Shared-surface note (ADR-0026)

This scenario touches shared observability surfaces. These are honest, declared
additions, but they mean existing scenarios need **positive-smoke addenda at next
certification**:

- **New scrape job** in `observability/prometheus.yml` (`job_name: 'book-metadata'`).
  Additive; harmless to other scenarios.
- **New rules file** `observability/rules/book-metadata-rules.yml` (the scenario's
  `own_additions`). Loaded by the shared Prometheus `rule_files` glob, so its
  alert is evaluated for **every** scenario. `BookMetadataTrafficStalled` is
  guarded by a "was recently active" clause so it stays quiet for scenarios that
  never exercise the provider (library-only storms, the decoy control). **Open
  interference:** `latency-cache-stampede` drives heavy provider traffic, and its
  correct fix (restoring the search cache) legitimately reduces that traffic — which
  could trip this rate-collapse alert. This must be checked (and the threshold /
  guard re-tuned) during certification.
- **Stub instrumentation:** `stub/book_metadata_api.py` gains a `prometheus_client`
  `/metrics` endpoint and metrics; `stub/Dockerfile` installs `prometheus_client`.
  This is our own harness stub (not substrate), and the `/v1/*` response behavior
  is unchanged, so it is transparent to the other scenarios that share the stub.

`observability/rules/booklogr-rules.yml` is **NOT** edited.

## CERTIFICATION PENDING (ADR-0026)

**This scenario is authored but NOT certified.** It ships with no
`verify/acceptance.json`, no `verify/headroom.md`, and no recorded fire times — by
design. Nothing here is fabricated evidence; the numbers marked `# TUNE-ON-CERT`
are provisional design targets, not measurements. The following live evidence is
still required before this scenario may count toward any A/B verdict:

1. **Determinism soak** — the primary alert fires reliably under the storm within
   `confirm_fire_timeout_seconds` (240 s), repeatably.
2. **2 cold arms** — two independent cold arm→confirm-fire runs, both firing.
3. **Solvability** — the reference fix (`solution/fix.patch`) drives the mitigation
   oracle to a pass (≥ 0.85) under still-active load.
4. **Anti-cheat negative** — a fix that stops load / clears only briefly scores
   < 0.85 (ADR-0004).
5. **De-tell judge** — the t0 bundle (alert brief + triage) leaks no root cause.
6. **≥ 1 graded agent attempt** — at least one real agent run graded end to end.
7. **Headroom qualification (#64)** — `tools/headroom` campaign writes
   `verify/headroom.md` reading `QUALIFIED` (baseline stays comfortably below
   threshold; the fault has real headroom).

Storm-specific certification items:

8. **Cross-service signal tuning** — confirm `BookMetadataTrafficStalled` fires
   under the fault and clears after the fix, with the coupling stream's rate and
   the alert's floor / recent-activity guard / windows tuned to real soak data
   (`# TUNE-ON-CERT`).
9. **Baseline non-contamination** — confirm the low-rate book-detail coupling
   stream does NOT push the healthy-baseline service p99 over threshold.
10. **Shared-surface regression** — positive-smoke the other three booklogr
    scenarios with the new rules file loaded (esp. `latency-cache-stampede`, per
    the interference note above).
11. **Resource headroom** — confirm the full-library materialize (150k ORM rows ×
    4 workers) does not OOM the API container under the storm; cap or tune if
    needed.
