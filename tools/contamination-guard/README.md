# contamination-guard

A programmatic gate that enforces **D8 (de-tell)** and **D12 (physical
substrate/harness separation)** as a build check instead of a doc decision.

The threat it defends against: an agent-under-test is handed a substrate repo
(e.g. `booklogr/booklogr` in the local Gitea forge) plus its live deployment, and is
supposed to diagnose an incident *as if it were a real production system*. If
the repo contains `// BUG #5`, a README boasting an "Incident Simulation
Dashboard", a `sreforge`-named Dockerfile, or committed logs with the harness's
absolute path, the agent can trivially infer it's a planted-fault rig — and the
evaluation is contaminated.

A written decision ("keep them separate") already existed when the leak
happened. **This tool exists because a decision a human must remember is weaker
than a check the build runs.**

## What it checks

| Check | Tier | Example caught |
|-------|------|----------------|
| Planted-bug markers | BLOCK | `// BUG #5: retries ALL errors` |
| Harness vocabulary | BLOCK | `sreforge`, `harness`, `oracle`, `de-tell`, `contamination` |
| Scenario / oracle names | BLOCK | `latency-cache-stampede`, `confirm-fire`, `verify-clear` |
| Simulation product copy | BLOCK | "Incident Simulation Dashboard", "trigger Prometheus alerts" |
| Injection confessions | BLOCK | "malformed ValidationPipe injection", "sed injection" |
| Harness files/dirs present | BLOCK | `load/`, `scenarios/`, `.claude/settings.local.json`, `driver.mjs` |
| Substrate → harness dep | BLOCK | `@sreforge/*` in `package.json` |
| Git history tells | BLOCK | commit subject/author referencing the harness |
| Ambiguous markers | WARN | `FIXME`, `XXX`, bare `inject`/`fault`/`scenario`/`oracle` |

The two-tier model is the whole point. A naive `grep harness|inject|fault|bug`
fires on `@Injectable`, `de**fault**`, "injection attacks", and "error
scenarios" in clean NestJS code — so people learn to ignore it. Here, every
pattern is **word-boundary anchored** and unambiguous tells **BLOCK** while
genuinely-dual-use words only **WARN** (a human glances and dismisses). Result:
zero false blocks on the real substrate.

## Usage

```bash
# from the sreforge harness root
node tools/contamination-guard/scan.mjs <substrate-dir>...
pnpm guard <substrate-dir>          # same, via package.json script
pnpm guard:strict <substrate-dir>   # WARN also fails the build

# options
--strict          treat WARN as failure
--policy <path>   alternate policy.json (per-stack tuning)
--max <n>         findings printed per rule (default 15)
--json            machine-readable output for CI
```

Exit `0` = PASS, `1` = FAIL (tells found), `2` = usage error.

## The one rule that makes it safe

**This tool lives in the harness and scans a substrate directory as an external
target. It is NEVER copied into a substrate repo.** A file literally named
`contamination-guard` sitting inside the app an agent inspects would be the
loudest tell of all. The substrate stays clean; the guard reaches in from
outside.

Enforcement points (all harness-side):
- **Import acceptance gate** — an imported substrate must scan clean before it's
  used as a use case: run the guard against the checkout and treat any BLOCK as a
  contamination leak to fix before the substrate goes live.
- **Conductor preflight** — `core/` should run the guard against the substrate
  checkout before deploying it to an agent, and refuse to launch on any BLOCK.
- **sreforge pre-commit / CI** — scan the substrate working copies on commit.

## Tuning

`policy.json` is data, not code. To adapt for a new stack, copy it and pass
`--policy`. Add genuine false positives a real product would contain to
`allowList` (regex per line). Promote a recurring WARN to a BLOCK by moving its
rule between the arrays. Keep every pattern `\b`-anchored — the credibility of
the gate depends on it never crying wolf.
