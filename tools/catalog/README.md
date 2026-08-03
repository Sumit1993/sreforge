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
identifier-shaped, an identity value containing a digit, an unknown `profile`, or an `id`/`use_case` that
disagrees with its directory. Every one of those names the offending manifest and field.

**Leakage allowlist.** The page is published at sreforge.sfun.cloud and may carry scenario identity only,
so the generator opens just two files per scenario — `scenario.toml`, from which it reads exactly `id`,
`use_case`, `stack` and `profile` (never `title` or `description`, which encode authored root causes), and
`verify/headroom.md`, from which it takes only the verdict word `QUALIFIED`/`DISQUALIFIED`; `verify/oracle.md`,
`solution/` and `inject/` are never read at all, and no median, threshold or score can reach the page.

Identity values must also be **digit-free**, which is stricter than the boundary literally needs. That is
deliberate: it makes "the page contains no digit at all" true by construction, which is the cheapest airtight
proof that no median, threshold or score leaked. The cost is that a versioned name like `postgres-15` is
rejected — loudly, at generation time. To allow one, relax `DIGIT_IN_VALUE` in `generate.mjs` and the
committed-page digit assertion in `test/generate.test.mjs` as a single deliberate change, and replace them
with an explicit check against the numbers in each `verify/headroom.md`.
