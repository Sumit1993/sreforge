#!/usr/bin/env node
// =============================================================================
// console.mjs — OPERATOR CONSOLE (ADR-0018 §1), CLI renderer.
//
// A human-facing, HARNESS-SIDE status view for the operator who drives/tests
// agents: which planes are up, the firing alert, deep-links to the real UIs, and
// recent run verdicts. NEVER agent-reachable (a host-side CLI; the web variant
// binds loopback only). Data + rationale live in console-model.mjs; the web
// variant is console-serve.mjs (`pnpm forge console booklogr SERVE=1`).
//   Run:  pnpm forge console booklogr
// =============================================================================
import { gatherModel, RUNS_DIR } from "./console-model.mjs";

const pad = (s, n) => String(s ?? "").padEnd(n);
const h = (s) => `\n\x1b[1m${s}\x1b[0m`;

const m = await gatherModel();
console.log(`\x1b[1mSREForge Operator Console — booklogr\x1b[0m  (harness-side · loopback only · not agent-reachable)`);

console.log(h("Planes"));
if (!m.dockerReachable) {
  console.log("  docker unreachable — is the engine (Rancher/Docker) running?");
} else {
  for (const p of m.planes) {
    console.log(`  ${pad(p.name, 14)} ${pad(p.tag + (p.detail ? ` (${p.detail})` : ""), 12)} ${p.up.join(", ")}`);
  }
}

console.log(h("Incident"));
if (!m.incident.reachable) {
  console.log("  (Prometheus not reachable — deploy plane down or still coming up)");
} else {
  const i = m.incident;
  console.log(`  ${pad("p99 (30s)", 14)} ${i.p99ms == null ? "n/a" : `${i.p99ms}ms`}  (SLO 300ms)`);
  console.log(`  ${pad("primary", 14)} ${i.primary} -> ${i.primaryFiring ? "\x1b[31mFIRING\x1b[0m" : "clear"}`);
  console.log(`  ${pad("firing", 14)} ${i.firing.length ? i.firing.join(", ") : "(none)"}`);
  if (i.suggest) console.log(`  ${pad("→ suggest", 14)} "${i.suggest}"`);
}

console.log(`${h("Deep links")}  (only the running services are live)`);
for (const l of m.links) console.log(`  ${pad(l.name, 14)} ${l.up ? l.url : "\x1b[2m— down —\x1b[0m"}`);

console.log(`${h("Recent runs")}  (${RUNS_DIR})`);
if (m.runs.length === 0) {
  console.log("  (none yet)");
} else {
  console.log(`  ${pad("run", 22)} ${pad("verdict", 10)} ${pad("score", 7)} scenario`);
  for (const r of m.runs) {
    const v = r.verdict === "passed" ? `\x1b[32m${pad("passed", 10)}\x1b[0m`
      : r.verdict === "?" ? pad("?", 10)
      : `\x1b[31m${pad(r.verdict, 10)}\x1b[0m`;
    console.log(`  ${pad(r.runId, 22)} ${v} ${pad(Number.isFinite(r.score) ? r.score.toFixed(2) : "—", 7)} ${r.scenario}`);
  }
}
console.log("");
