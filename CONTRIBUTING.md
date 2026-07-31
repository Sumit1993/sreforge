# Contributing to SREForge

Thanks for your interest in SREForge — a contamination-controlled,
event-triggered evaluation harness for autonomous SWE/SRE agents. This is a
young, focused project; contributions of all sizes are welcome.

## Ground rules

- **`main` is protected.** Every change lands through a pull request with green
  CI. Direct pushes to `main` are not allowed (for anyone, including the
  maintainer).
- **Never commit secrets, and never commit the substrate.** `.env` and the
  imported `substrate/` checkout are gitignored on purpose — keep them that way.
- **Do not "fix" the substrate.** The apps under `use-cases/**` are the system
  *under evaluation*; some carry deliberate regressions that the harness exists
  to exercise. Don't repair them in this repo.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 18** and **pnpm** (the repo pins pnpm via the
`packageManager` field — `corepack enable` will select the right version).

The engine lives in `core/` and builds on its own lockfile:

```bash
git clone https://github.com/prismalens/sreforge.git
cd sreforge/core
pnpm install --frozen-lockfile
pnpm build        # tsc -> dist/
```

Repo-root tooling (plain Node scripts, no install needed):

```bash
pnpm guard        # contamination-guard: scan a target for harness leakage
pnpm detell       # detell-judge: score a target for "is this a rig?" tells
```

Each use-case rig lives under `use-cases/<name>/stacks/<stack>/`; see that
stack's `scripts/README.md` for its lifecycle (bring up → arm → run an incident
→ verify → tear down).

## Making a change

1. **Branch** off `main`: `git checkout -b fix/short-description`.
2. Make the change. Add or update tests where it makes sense.
3. Make sure the relevant build/tests pass locally (at minimum, `core` builds).
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`.
   The PR *title* must also be a conventional commit — it becomes the squash
   commit subject and is linted by CI.
5. **Open a PR** against `main`. CI must be green before it can merge.

## Knowledge base (for agents)

This repo's durable design notes live in an external, maintainer-private
knowledge hub; [AGENTS.md](AGENTS.md) explains how AI coding agents should work
here. External contributors don't need the hub — the code, this guide, and the
in-repo READMEs are self-contained.

## Code style

- Small, cohesive files (prefer many small files over few large ones).
- Explicit error handling; fail fast at boundaries with clear messages.
- No `console.log` debris and no hardcoded secrets.

## Reporting bugs and requesting features

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
