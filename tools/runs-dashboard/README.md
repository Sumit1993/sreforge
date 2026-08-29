# runs-dashboard — private run-data browser

A read-only, loopback-only web view over the **private** runs store: the full,
transcript-bearing run records that ADR-0026 §7 keeps out of this public repo.
Three levels on one page — scenarios → the runs of one scenario → one record as
formatted JSON.

This is an operator tool, not part of the harness. It is deliberately *not* a
`pnpm forge` verb: it never drives a use-case, and nothing in a run depends on it.

```
pnpm runs:dashboard          # → http://127.0.0.1:7421
```

(equivalently `node tools/runs-dashboard/server.mjs` — zero dependencies, no build)

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7421` | Loopback port to listen on. The control dashboard uses 7420; these are neighbours, not the same surface. |
| `SREFORGE_RUNS_DIR` | `<repo-root>/../sreforge-runs` | The private store. Resolved to an absolute path at startup and echoed in the boot line. |

The default resolves to the `sreforge-runs` checkout sitting **beside** this
repo. That holds for a normal clone; inside a `git worktree` the sibling path is
the worktree's parent, so pass `SREFORGE_RUNS_DIR` explicitly there.

`PORT` is validated at startup: it must be an integer in 1–65535, and the server
exits with a message rather than listening on a nonsense port. `0` is rejected
too — it would mean "any free port", leaving the Host allowlist naming a port the
server is not on.

### When the store is incomplete

The server still starts and every route still answers — it never crashes on a
missing store. `/api/summary` and `/api/runs` report `ok: false` with an error
naming the part that is actually missing, and the page shows that message instead
of a table:

| Missing | `error` |
| --- | --- |
| the store directory | `store not found at <STORE_DIR>` |
| `index.json` | `index.json not found at <path>` |
| `records/` | `records/ not found at <path>` |

These are checked in that order, so the first one that fails is the one reported.

`/api/run/<sha256>` is separate: it reads one file directly and answers **404**
(`no record <sha>`) when that record is absent, or **400** when the id is not a
sha256 hex digest. It does not carry the `ok`/`error` store envelope.

Individual records that cannot be used are not fatal either. A file under
`records/` whose name is not `<sha256>.json`, or whose contents will not parse,
is skipped and listed by name in the `unreadable` array of the store header,
while the rest of the scan continues.

## Guarantees

- **Read-only.** The server opens files for reading and nothing else: no verb is
  spawned, no file is written, nothing is banked. Pointing it at the store cannot
  modify the store.
- **Loopback only.** It binds `127.0.0.1` exclusively — the never-agent-reachable
  guardrail of ADR-0018 §1. Agents run in containers on deploy networks and
  cannot reach host loopback, which is what makes it safe to serve full
  transcripts here in the clear.
- **Host-header checked.** Binding loopback does not by itself stop DNS
  rebinding, so requests must also carry a loopback `Host` (`127.0.0.1` or
  `localhost`, with or without the port). Anything else gets a 403.
- **No egress, no build.** Vanilla JS and inline CSS, no external assets, no
  bundler. `index.html` is read from disk per request, so edit-and-refresh works.

Do not bind another interface and do not put this behind a proxy. The whole
safety argument is that the port is unreachable from anywhere but this host.

## Routes

| Route | Returns |
| --- | --- |
| `GET /` | the dashboard page |
| `GET /api/summary` | store header + per-scenario aggregates |
| `GET /api/runs?scenario=<id>` | run rows for one scenario, newest first |
| `GET /api/run/<sha256>` | one full record, verbatim |

`<sha256>` is the record's content hash, which is also its filename under
`records/`. It must match `^[0-9a-f]{64}$` — that anchor is the path guard, so
nothing else can be joined onto the records directory.

Records are rescanned when `records/` or `index.json` changes (mtime-keyed
cache); at ~100 files a full rescan is cheap.

## Layout and tests

- `server.mjs` — routing, store loading, the loopback and path guards.
- `lib.mjs` — pure aggregation over parsed records (no I/O), so the arithmetic is
  testable without standing a server up.
- `index.html` — the three-level UI.

```
pnpm test:runs-dashboard
```

## Note on the summary columns

The rate column is labelled per scenario. Decoy scenarios (`scenario_id` starting
`decoy-`) get a **decoy rate** only when their records carry an explicit
fell-for-decoy signal in `score.signals[]`; today's oracle emits only the generic
mitigation signal set (`ci_green`, `alert_cleared`, `sustained_clear`,
`time_to_clear`, `no_new_alerts`), so the column falls back to the plain **pass
rate**. That fallback is intentional — inventing decoy semantics from signals
that do not carry them would misreport the eval.

Pass rate counts the `passed` verdict only; `failed` and `rejected` both count
against it. The run-kind split is derived from the `run_id` prefix
(`campaign-`, `smoke-pos`/`smoke-neg`, `poscontrol-`, `run-`, else `other`), and
`other` is legitimately the largest bucket for most scenarios — many historical
runs use ad-hoc prefixes (`requalify-`, `headroom-`, `ext-live-`, …).
