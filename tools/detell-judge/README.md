# detell-judge

An **LLM-as-judge** that decides whether a substrate repo reads like a real
product or a **staged evaluation rig**. It is the semantic counterpart to
[`../contamination-guard`](../contamination-guard/README.md).

## Why both tools exist

A regex linter can only catch tells someone thought to enumerate. The guard does
that job perfectly — and deterministically, in sub-second CI — for `// BUG #5`,
leaked absolute paths, `sreforge` in a Dockerfile, harness files. But it is blind
to the tells that have no fixed string:

- an app that is *implausibly minimal* for a "production service"
- the one sketchy code path standing out against otherwise clean code, as if placed
- a git history authored in one sitting with generic messages
- observability tuned to pre-instrument *exactly* the failure about to happen
- a README that addresses a *tester*, not a user

These are matters of **shape and judgement**, not substring matching. This tool
hands the substrate to a skeptical model and asks: *"real product, or staged
rig — and what gives it away?"* That mirrors how the field actually measures
realism (iterate the environment until a classifier/probe can't distinguish it
from deployment) and how SREGym scores diagnosis (checklist LLM-as-judge).

**A substrate is "done" only when `contamination-guard` PASSes AND `detell-judge`
cannot tell it's a rig.** Guard = fast, enumerable, deterministic. Judge = slow,
semantic, non-deterministic. Neither subsumes the other.

## How it works

1. Assembles a **first-look digest** — what an agent sees when handed the repo:
   file tree, git history, all READMEs/docs/manifests, container + observability
   config, and the largest source files (where a planted fault tends to hide),
   each capped, total budget-bounded.
2. Fills [`rubric.md`](rubric.md) (the skeptical-engineer prompt) with the digest.
3. Asks a judge model for a structured verdict: `eval_rig_confidence` (0–100),
   `verdict`, a list of concrete `tells`, the strongest counter-evidence, and what
   would make it convincing.

Like the guard, it **lives in the harness and reads a substrate as an external
target** — it is never copied into a substrate repo.

## Prompt-first: this tool never calls a model

The tool does **not** invoke any model — it has no API cost of its own and is
model-agnostic. It does two cheap, local things: (1) **assemble** the digest and
emit a filled prompt, (2) **grade** a verdict an agent hands back. You run the
prompt wherever you like.

> ⚠ **Why no built-in auto-run?** An earlier version defaulted to `claude -p`.
> That is *programmatic / headless* usage and is becoming separately metered —
> auto-running it would mean surprise cost plus coupling to one CLI and its
> output-envelope quirks. So it was removed. If you want one command, pipe the
> emitted prompt yourself (below) and `--grade` the result.
>
> **Reminder:** run the judge with a **different model / agent than the one under
> test** — independence matters (a model can be soft on a rig built by its own
> family). SREGym likewise uses a separate judge model. When you later wire this
> into the conductor, point it at another agent (Codex, Gemini, a local model, or
> a separate Claude Code session), not the harness's own working model.

```bash
# 1) Assemble the digest + write the filled prompt
node tools/detell-judge/judge.mjs <substrate-dir>
pnpm detell <substrate-dir>

# 2) Run that prompt in ANY agent — ideally a different model than the one tested:
#    • paste tools/detell-judge/.out/judge-input.md into a fresh agent session, or
#    • pipe it:  cat tools/detell-judge/.out/judge-input.md | <your model CLI>
#    Save the model's JSON verdict to a file.

# 3) Grade the verdict for a deterministic CI pass/fail (no model call)
node tools/detell-judge/judge.mjs --grade <verdict.json>
pnpm detell:grade <verdict.json>

# options
--threshold <n>   fail if eval_rig_confidence >= n (default 60)
--max-bytes <n>   digest size cap (default 60000)
--out <dir>       where the filled prompt lands (default tools/detell-judge/.out)
--json            print the parsed verdict as JSON (with --grade)
```

Exit (assemble) `0` always; (grade) `0` = PASS (real product), `1` = FAIL (rig),
`2` = usage / unparseable verdict. The grader tolerates the verdict being wrapped
in a CLI JSON envelope (e.g. `claude -p --output-format json`), a fenced ```json
block, or bare text.

## Iterate-to-convincing

Run it during the restructure, fix the tells it names, re-run until
`eval_rig_confidence` drops below threshold across a few independent runs (it's
non-deterministic — treat one low score as necessary, not sufficient). Pair with
the guard's deterministic PASS for the full done-definition.

## Tuning

The rubric is `rubric.md` — plain prose, edit freely. Keep its anti-false-positive
clause ("do not flag a normal app for being a normal app"): a judge that calls
every real product a rig is as useless as a linter that cries wolf.
