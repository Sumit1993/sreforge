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

The governing qualification mode is declared per-scenario in `scenario.toml` under `[verify].qualification_mode` (defaulting to `score-headroom` for all scenarios).

- `score-headroom` (governing metric across all scenarios):
  - Evaluates qualification based on whether mitigation median is `< 0.8` (QUALIFIED) or `>= 0.8` (DISQUALIFIED).
  - Example: `node tools/headroom/campaign.mjs run --scenario use-cases/booklogr/scenarios/db-pool-exhaustion-deploy`

- `decoy-rate` (informational statistic):
  - Reported in `verify/headroom.md` as `Falls-for-decoy Rate: x/y`, but does not gate qualification.
  - Can be passed explicitly via `--mode decoy-rate` for opt-in legacy evaluation.
  - Example: `node tools/headroom/campaign.mjs run --scenario use-cases/booklogr/scenarios/decoy-deploy-control --mode decoy-rate`
