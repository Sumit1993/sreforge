---
title: Contributing
description: Ground rules, development setup, and the change workflow for SREForge.
---

SREForge is a young, focused project; contributions of all sizes are welcome.
This page mirrors the repo's
[`CONTRIBUTING.md`](https://github.com/prismalens/sreforge/blob/main/CONTRIBUTING.md)
— that file is the source of truth.

## Ground rules

- **`main` is protected.** Every change lands through a pull request with green
  CI. Direct pushes to `main` are not allowed (for anyone).
- **Never commit secrets, and never commit the substrate.** `.env` and the
  imported substrate checkout are gitignored on purpose — keep them that way.
- **Do not "fix" the substrate.** The apps under `use-cases/**` are the system
  *under evaluation*; some carry deliberate regressions the harness exists to
  exercise. Don't repair them.
- **Keep PRs focused.** One logical change per PR makes review fast.

## Development setup

Requirements: **Node ≥ 18** and **pnpm** (the repo pins pnpm via the
`packageManager` field — `corepack enable` selects the right version).

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

Each use-case rig lives under `use-cases/<name>/stacks/<stack>/`; see that stack's
`scripts/README.md` (or `pnpm forge menu <use-case>`) for its lifecycle.

## Making a change

1. **Branch** off `main`: `git checkout -b fix/short-description`.
2. Make the change. Add or update tests where it makes sense.
3. Make sure the relevant build/tests pass locally (at minimum, `core` builds).
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`. The
   PR *title* must also be a conventional commit — it becomes the squash commit
   subject and is linted by CI.
5. **Open a PR** against `main`. CI must be green before it can merge.

## Working on these docs

The docs site is an Astro + Starlight project under `docs/`:

```bash
cd docs
pnpm install
pnpm dev          # local preview at http://localhost:4321/
pnpm build        # production build into docs/dist/
```

Content lives in `docs/src/content/docs/`. Pushing to `main` rebuilds and
redeploys the site to GitHub Pages automatically.

## Code style

- Small, cohesive files (prefer many small files over few large ones).
- Explicit error handling; fail fast at boundaries with clear messages.
- No `console.log` debris and no hardcoded secrets.

## Reporting bugs and security issues

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see
[`SECURITY.md`](https://github.com/prismalens/sreforge/blob/main/SECURITY.md).
