#!/usr/bin/env node
// =============================================================================
// tools/dashboard/server.mjs — SREForge OPERATOR CONTROL DASHBOARD (ADR-0024).
//
// Always-on, cross-use-case, HARNESS-SIDE control plane. A thin GUI-over-CLI:
// it SPAWNS `pnpm forge <verb> <use-case>` child processes (never imports the
// engine — the CLI stays the single source of truth), streams their stdout to
// the browser via SSE, and reuses each use-case's own scripts/console-model.mjs
// for status. Concurrency is per-use-case single-flight (refuse-not-queue);
// docker is the source of truth for plane status (re-derived each refresh).
//
// LOOPBACK ONLY (127.0.0.1) — this is the never-agent-reachable guardrail
// (ADR-0018 §1): agents live in containers on deploy networks and cannot reach
// host loopback. It is strictly separate from the neutral agent page. The
// frontend is a static file (index.html) served from disk — no build.
//
//   Run:  pnpm forge dashboard        (or: node tools/dashboard/server.mjs)
//   PORT  default 7420.
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const USE_CASES_DIR = resolve(REPO_ROOT, "use-cases");
const PORT = Number(process.env.PORT || 7420);
const HOST = "127.0.0.1"; // loopback ONLY — the never-agent-reachable guardrail.

// Verbs the dashboard may invoke. spawn() uses an argv array (no shell), and we
// still bound the surface to the known forge verbs + validate args as KEY=VALUE.
const VERBS = new Set([
  "fresh", "up", "arm", "agent", "agent-up", "mcp", "run", "verify", "incident", "e2e", "down", "status", "console",
]);
const ARG_RE = /^[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_.,:@/-]*$/;

// ---- discover use-cases: use-cases/<name>/stacks/<stack> --------------------
function discover() {
  if (!existsSync(USE_CASES_DIR)) return [];
  const out = [];
  for (const name of readdirSync(USE_CASES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const stacksDir = join(USE_CASES_DIR, name, "stacks");
    if (!existsSync(stacksDir)) continue;
    for (const stack of readdirSync(stacksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const model = join(stacksDir, stack, "scripts", "console-model.mjs");
      out.push({ useCase: name, stack, model: existsSync(model) ? model : null });
    }
  }
  return out;
}

// ---- per-use-case status via its OWN console-model.mjs (read-only) ----------
async function statusFor(uc) {
  if (!uc.model) return { reachable: false, note: "no console-model.mjs" };
  try {
    const mod = await import(pathToFileURL(uc.model).href);
    return await mod.gatherModel();
  } catch (e) {
    return { reachable: false, note: `model error: ${e.message}` };
  }
}

// ---- in-memory job registry: per-use-case single-flight --------------------
const jobs = new Map(); // jobId -> {id, useCase, verb, args, log:[], done, code, clients:Set<res>, startedAt}
const busy = new Map(); // useCase -> jobId
let seq = 0;

function invoke(useCase, verb, args) {
  if (!VERBS.has(verb)) throw new Error(`unknown verb '${verb}'`);
  if (!discover().some((u) => u.useCase === useCase)) throw new Error(`unknown use-case '${useCase}'`);
  for (const a of args) if (!ARG_RE.test(a)) throw new Error(`bad arg '${a}'`);
  if (busy.has(useCase)) throw new Error(`${useCase} is busy (${jobs.get(busy.get(useCase))?.verb} in flight)`);

  const id = `job-${++seq}`;
  const job = { id, useCase, verb, args, log: [], done: false, code: null, clients: new Set(), startedAt: Date.now() };
  jobs.set(id, job);
  busy.set(useCase, id);

  const child = spawn("pnpm", ["forge", verb, useCase, ...args], { cwd: REPO_ROOT });
  const push = (chunk) => {
    const s = chunk.toString();
    job.log.push(s);
    if (job.log.length > 2000) job.log.shift();
    for (const res of job.clients) res.write(`data: ${JSON.stringify({ line: s })}\n\n`);
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", (e) => { push(`spawn error: ${e.message}\n`); job.done = true; job.code = -1; busy.delete(useCase); });
  child.on("close", (code) => {
    job.done = true; job.code = code; busy.delete(useCase);
    for (const res of job.clients) { res.write(`event: done\ndata: ${JSON.stringify({ code })}\n\n`); res.end(); }
    job.clients.clear();
  });
  return id;
}

// ---- http helpers ----------------------------------------------------------
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
}

async function stateSnapshot() {
  const ucs = discover();
  const rows = await Promise.all(ucs.map(async (u) => ({
    useCase: u.useCase, stack: u.stack, hasModel: !!u.model,
    busy: busy.has(u.useCase) ? { jobId: busy.get(u.useCase), verb: jobs.get(busy.get(u.useCase))?.verb } : null,
    status: await statusFor(u),
  })));
  return { host: `${HOST}:${PORT}`, verbs: [...VERBS], useCases: rows };
}

// ---- server ----------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  try {
    if (url.pathname === "/") {
      // Static frontend, read from disk each request (no build; edit-and-refresh).
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(HERE, "index.html"), "utf8"));
      return;
    }
    if (url.pathname === "/api/state") { json(res, 200, await stateSnapshot()); return; }

    if (url.pathname === "/api/invoke" && req.method === "POST") {
      const { useCase, verb, args = [] } = JSON.parse((await readBody(req)) || "{}");
      try { json(res, 200, { id: invoke(useCase, verb, args) }); }
      catch (e) { json(res, 409, { error: e.message }); }
      return;
    }

    if (url.pathname.startsWith("/api/stream/")) {
      const job = jobs.get(url.pathname.split("/").pop());
      if (!job) { json(res, 404, { error: "no such job" }); return; }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      for (const line of job.log) res.write(`data: ${JSON.stringify({ line })}\n\n`);
      if (job.done) { res.write(`event: done\ndata: ${JSON.stringify({ code: job.code })}\n\n`); res.end(); return; }
      job.clients.add(res);
      req.on("close", () => job.clients.delete(res));
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SREForge control dashboard → http://${HOST}:${PORT}  (loopback only · not agent-reachable · Ctrl-C to stop)`);
});
