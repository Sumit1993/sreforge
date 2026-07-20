# `tools/headroom`

Baseline headroom qualification campaign for sreforge.

## Subcommands

```bash
node tools/headroom/campaign.mjs run --scenario <id> [--runs 3] [--use-case booklogr] [--agent-cmd "<cmd>"] [--id-prefix headroom]
node tools/headroom/campaign.mjs score --scenario <id> --run-ids <rid1,rid2,...> [--driver "<label>"] [--judge]
```

### `run`
Executes unattended Raw Agent runs using the existing `auto` composite, driving a specific scenario sequentially. By default, it executes 3 cycles, storing runs under a prefix `headroom-<scenario-short>-<i>`. Once finished, it invokes `score` to grade the results.

### `score`
Scores an array of banked runs against the qualification criteria. Evaluates records and `diagnosis.json` (if present) for each run, calculates mitigation and diagnosis medians, evaluates the falls-for-decoy rate, and writes `verify/headroom.md`. Can optionally invoke the `rca-judge` via `--judge`.

## External-Driver Workflow

If you bank runs externally via other agents or workflows, you can skip `run` and use `score` directly on those banked run IDs:

```bash
node tools/headroom/campaign.mjs score --scenario <id> --run-ids rid1,rid2,rid3 --driver "claude-code"
```

## Modes & Target Scenarios

Target scenarios for this qualification include:
- `use-cases/booklogr/scenarios/db-pool-exhaustion-deploy`
  - **Mode:** `score-headroom` (default)
  - Fails if the mitigation median `>= 0.8`.
  - Example: `node tools/headroom/campaign.mjs run --scenario use-cases/booklogr/scenarios/db-pool-exhaustion-deploy`

- `use-cases/booklogr/scenarios/decoy-deploy-control`
  - **Mode:** `decoy-rate`
  - Fails if the false-leads rate is `0/m` or if there are no diagnoses available.
  - Example: `node tools/headroom/campaign.mjs run --scenario use-cases/booklogr/scenarios/decoy-deploy-control --mode decoy-rate`
