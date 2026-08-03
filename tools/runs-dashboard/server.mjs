#!/usr/bin/env node
// =============================================================================
// tools/runs-dashboard/server.mjs — SREForge PRIVATE RUN-DATA DASHBOARD.
//
// Read-only browser over the private runs store (the `sreforge-runs` sibling
// checkout that ADR-0026 §7 keeps full, transcript-bearing records in). It only
// ever READS: no verb is spawned, no file is written, nothing is banked. The
// public repo keeps pruned records; this is the operator's window on the full
// ones, which is exactly why it never leaves the host.
//
// LOOPBACK ONLY (127.0.0.1) — the never-agent-reachable guardrail (ADR-0018 §1):
// agents live in containers on deploy networks and cannot reach host loopback.
// Full transcripts are served here in the clear, so that boundary is the whole
// safety story: do NOT bind another interface. The frontend is a static file
// (index.html) served from disk — no build.
//
// The bind is backed by a Host-header check (ALLOWED_HOSTS below). Binding alone
// does not stop DNS rebinding: a page on an attacker-controlled origin can point
// its own hostname at 127.0.0.1 and have the victim's browser read this port for
// it. Such a request arrives on a genuinely loopback socket — the Host header is
// the only thing that still names the attacker's origin — so every request must
// carry a loopback authority or it is refused with 403.
//
//   Run:  pnpm runs:dashboard        (or: node tools/runs-dashboard/server.mjs)
//   PORT               default 7421.
//   SREFORGE_RUNS_DIR  default <repo-root>/../sreforge-runs.
// =============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runRows, summarizeScenarios } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const STORE_DIR = resolve(process.env.SREFORGE_RUNS_DIR || resolve(REPO_ROOT, "..", "sreforge-runs"));
const RECORDS_DIR = join(STORE_DIR, "records");
const INDEX_JSON = join(STORE_DIR, "index.json");
const PORT = Number(process.env.PORT || 7421);
const HOST = "127.0.0.1"; // loopback ONLY — the never-agent-reachable guardrail.

// Record filenames are the content sha256. Anchored hex-64 is also the path
// guard for /api/run/<sha> — nothing else can ever be joined onto RECORDS_DIR.
const SHA_RE = /^[0-9a-f]{64}$/;

// Anti-DNS-rebinding: the only Host authorities we answer to. A rebound request
// carries the attacker's hostname here, so it never matches.
const ALLOWED_HOSTS = new Set([HOST, `${HOST}:${PORT}`, "localhost", `localhost:${PORT}`]);
const hostAllowed = (host) => typeof host === "string" && ALLOWED_HOSTS.has(host.toLowerCase());

// ---- store loading: cached, invalidated on records/ mtime -------------------
let cache = { key: null, store: null };

function loadStore() {
  if (!existsSync(STORE_DIR)) {
    return { ok: false, path: STORE_DIR, error: `store not found at ${STORE_DIR}`, records: [], total: 0 };
  }
  if (!existsSync(INDEX_JSON)) {
    return { ok: false, path: STORE_DIR, error: `index.json not found at ${INDEX_JSON}`, records: [], total: 0 };
  }
  if (!existsSync(RECORDS_DIR)) {
    return { ok: false, path: STORE_DIR, error: `records/ not found at ${RECORDS_DIR}`, records: [], total: 0 };
  }

  // ~100 files: a full rescan is cheap, so the only cache key we need is the
  // directory mtime (bumped whenever a record is added or removed).
  const key = `${statSync(RECORDS_DIR).mtimeMs}:${statSync(INDEX_JSON).mtimeMs}`;
  if (cache.key === key && cache.store) return cache.store;

  const records = [];
  const unreadable = [];
  for (const name of readdirSync(RECORDS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const sha256 = name.slice(0, -".json".length);
    try {
      // sha256 rides along on the record so a UI row can link to its full JSON.
      records.push({ ...JSON.parse(readFileSync(join(RECORDS_DIR, name), "utf8")), sha256 });
    } catch (e) {
      unreadable.push({ name, error: e.message });
    }
  }

  let indexed = null;
  try { indexed = JSON.parse(readFileSync(INDEX_JSON, "utf8")); } catch { /* index is advisory here */ }

  const store = {
    ok: true, path: STORE_DIR, error: null, records,
    total: records.length,
    index_entries: Array.isArray(indexed) ? indexed.length : null,
    unreadable,
  };
  cache = { key, store };
  return store;
}

// ---- http helpers ----------------------------------------------------------
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

const storeHead = (s) => ({
  store: s.path, ok: s.ok, error: s.error, total_records: s.total,
  index_entries: s.index_entries ?? null,
  unreadable: (s.unreadable ?? []).map((u) => u.name),
});

// ---- server ----------------------------------------------------------------
const server = createServer((req, res) => {
  // Host check BEFORE anything is parsed or served — see the header note on DNS
  // rebinding. Nothing below this line runs for a non-loopback authority.
  if (!hostAllowed(req.headers.host)) {
    json(res, 403, { error: "forbidden: this dashboard answers only to a loopback Host" });
    return;
  }

  // Parse inside a guard: a request target of `//` is a protocol-relative
  // reference, so `new URL("//", "http://127.0.0.1")` resolves to an empty host
  // and throws. Outside a try that TypeError reaches the event loop uncaught and
  // takes the whole process down — one stray request would end the session.
  let url;
  try {
    url = new URL(req.url, `http://${HOST}`);
  } catch {
    json(res, 400, { error: "malformed request target" });
    return;
  }

  try {
    if (url.pathname === "/") {
      // Static frontend, read from disk each request (no build; edit-and-refresh).
      // Read first: a failed read must fall through to the 500 below, and once a
      // 200 header is written that is no longer possible.
      const html = readFileSync(join(HERE, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/summary") {
      const s = loadStore();
      json(res, 200, { ...storeHead(s), scenarios: s.ok ? summarizeScenarios(s.records) : [] });
      return;
    }

    if (url.pathname === "/api/runs") {
      const scenario = url.searchParams.get("scenario");
      if (!scenario) { json(res, 400, { error: "missing ?scenario=<id>" }); return; }
      const s = loadStore();
      json(res, 200, { ...storeHead(s), scenario, runs: s.ok ? runRows(s.records, scenario) : [] });
      return;
    }

    if (url.pathname.startsWith("/api/run/")) {
      const sha = url.pathname.slice("/api/run/".length);
      if (!SHA_RE.test(sha)) { json(res, 400, { error: "run id must be a sha256 hex digest" }); return; }
      const file = join(RECORDS_DIR, `${sha}.json`);
      if (!existsSync(file)) { json(res, 404, { error: `no record ${sha}` }); return; }
      // Private side — the full record, transcript and all, is what we came for.
      // Read before the header, same reason as the static frontend above: a read
      // that throws (deleted between the check and here, permissions) must still
      // be answerable with a 500.
      const body = readFileSync(file, "utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const s = loadStore();
  console.log(`SREForge runs dashboard → http://${HOST}:${PORT}  (loopback only · not agent-reachable · Ctrl-C to stop)`);
  console.log(s.ok ? `store: ${s.path}  (${s.total} records)` : `store: ${s.error}`);
});
