#!/usr/bin/env node
// SREForge node-compose load driver — zero dependencies (Node 18+ global fetch).
//
// Two modes:
//   baseline  healthy traffic (GET/POST) at a gentle, rate-limit-safe pace.
//   storm     the `latency-retry-storm` fault injector — a sustained, RATE-
//             CONTROLLED flood of malformed DELETE /api/todos/<non-integer>
//             requests. Each request that reaches the handler hits the
//             retry-of-non-transient-error bug (~270ms of backoff + HTTP 500),
//             driving p99 request latency over the alert threshold.
//
// Why rate-controlled, and why LOW: the API rate-limits the DELETE route to
// ~100 req/min on a FIXED 60s window with BURST admission — it lets ~100
// through, then returns fast 429s for the rest of the window. Above the limit
// the slow 500s arrive in bursts, so p99 oscillates (high ~30s, low ~30s) and
// the alert can never sustain its `for: 30s`. So the storm runs UNDER the
// admission limit (~1.5 rps = 90/min): every request reaches the handler as a
// steady 500 @ ~270ms, zero 429s, and p99 holds steady at ~0.495s — the alert
// fires ~35s in and stays firing. Counterintuitively, MORE load makes the alert
// LESS reliable. This is the determinism lever from decision D10.
//
// The storm runs CONTINUOUSLY and is NOT stopped during verification — the
// closed-loop oracle requires the alert to clear because the deployed fix works
// while the fault is still active.
//
// Usage:
//   node load/driver.mjs --mode=storm  [--target=http://localhost:3000]
//                        [--rps=1.5] [--duration=0] [--quiet]
//   node load/driver.mjs --mode=baseline [--rps=2]
//
// Stop with SIGINT/SIGTERM — prints a summary and exits 0.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);

const MODE = args.mode || "storm";
const TARGET = (args.target || process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");
const API = `${TARGET}/api`;
const RPS = Number(args.rps) || (MODE === "storm" ? 1.5 : 2);
const DURATION_S = Number(args.duration) || 0; // 0 = run until signalled
const QUIET = args.quiet === "true";
const ORIGIN = args.origin || "http://localhost:3001"; // mimic the real frontend
const MAX_INFLIGHT = 50; // backpressure so a stalled API can't pile up requests

const TODO_TEXTS = [
  "Review pull requests", "Update dependencies", "Write unit tests",
  "Deploy to staging", "Refactor the cache layer", "Triage the on-call queue",
];
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
// A non-numeric id => Number(id) === NaN => the retry storm.
const malformedId = () => "x" + Math.random().toString(36).slice(2, 8);

const stats = { sent: 0, "2xx": 0, "4xx": 0, "5xx": 0, err: 0 };
let inflight = 0;
let running = true;

function send(method, path, body) {
  if (inflight >= MAX_INFLIGHT) return; // shed load rather than queue unboundedly
  inflight++;
  stats.sent++;
  fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: body ? JSON.stringify(body) : undefined,
  })
    .then(async (res) => {
      await res.arrayBuffer().catch(() => {});
      const cls = `${Math.floor(res.status / 100)}xx`;
      if (cls in stats) stats[cls]++;
      else stats.err++;
    })
    .catch(() => {
      stats.err++; // connection refused during a redeploy, etc. — keep going
    })
    .finally(() => {
      inflight--;
    });
}

function nextRequest() {
  if (MODE === "storm") {
    send("DELETE", `/todos/${malformedId()}`);
    return;
  }
  const r = Math.random();
  if (r < 0.7) send("GET", "/todos");
  else send("POST", "/todos", { todo: pick(TODO_TEXTS), userId: 1 + rand(4) });
}

function reporter() {
  let last = 0;
  const t = setInterval(() => {
    if (QUIET) return;
    const d = stats.sent - last;
    process.stderr.write(
      `[${MODE}] sent=${stats.sent} (+${d}/5s ~${(d / 5).toFixed(0)}rps) ` +
      `inflight=${inflight} 2xx=${stats["2xx"]} 4xx=${stats["4xx"]} 5xx=${stats["5xx"]} err=${stats.err}\n`,
    );
    last = stats.sent;
  }, 5000);
  t.unref();
}

function stop(signal) {
  if (!running) return;
  running = false;
  process.stderr.write(
    `\n[${MODE}] stopped (${signal}). total sent=${stats.sent} ` +
    `2xx=${stats["2xx"]} 4xx=${stats["4xx"]} 5xx=${stats["5xx"]} err=${stats.err}\n`,
  );
  setTimeout(() => process.exit(0), 150);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

process.stderr.write(`[${MODE}] target=${API} rps=${RPS} duration=${DURATION_S || "∞"}s origin=${ORIGIN}\n`);
reporter();
if (DURATION_S > 0) setTimeout(() => stop("duration"), DURATION_S * 1000);
setInterval(() => {
  if (running) nextRequest();
}, Math.max(1, Math.round(1000 / RPS)));
