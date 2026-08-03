# tools/catalog

Generates the public scenario catalog page — `docs/src/content/docs/reference/scenario-catalog.md` —
by walking `use-cases/*/scenarios/*/`. The generated file is committed; the generator is the source
of truth, so edit `generate.mjs`, never the page. Zero dependencies, offline, same lint culture as
`tools/rules-lint` and `tools/record-lint`.

| Script | Does |
| --- | --- |
| `pnpm catalog:gen` | Regenerate and overwrite the committed page. |
| `pnpm catalog:check` | Staleness gate — regenerate in memory and byte-compare against the committed page. Runs in CI (the `record-lint` job in `.github/workflows/ci.yml`). |
| `pnpm test:catalog` | `node --test` suite, including the leakage assertions. |

Exit codes (both modes): **0** clean — page written, or `--check` found it up to date. **1** — `--check`
only: the committed page has drifted; the message names `pnpm catalog:gen` as the fix. **2** — a manifest
violated the boundary and nothing was written: a missing identity field, an identity value that is not
identifier-shaped, an unknown `profile`, or an `id`/`use_case` that disagrees with its directory.

**Leakage allowlist.** The page is published at sreforge.sfun.cloud and may carry scenario identity only,
so the generator opens just two files per scenario — `scenario.toml`, from which it reads exactly `id`,
`use_case`, `stack` and `profile` (never `title` or `description`, which encode authored root causes), and
`verify/headroom.md`, from which it takes only the verdict word `QUALIFIED`/`DISQUALIFIED`; `verify/oracle.md`,
`solution/` and `inject/` are never read at all, and no median, threshold or score can reach the page.
