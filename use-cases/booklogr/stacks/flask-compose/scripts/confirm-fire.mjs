#!/usr/bin/env node
// confirm-fire gate (ADR-0010) for the booklogr stack.
//
// Polls Prometheus until the expected alert is firing, within a timeout. This
// guarantees the agent is only ever handed a genuine, reproduced incident —
// never a non-incident. Prints the alert_fired_at timestamp on success.
//
//   node scripts/confirm-fire.mjs [--alert=BooklogrApiLatencyP99High]
//                                 [--timeout=240] [--interval=3] [--prom=URL]
//
// Exit 0 = alert firing (incident confirmed); exit 1 = timed out.

import { PROM, P99_EXPR, PRIMARY_ALERT, getAlerts, firing, queryScalar, sleep, nowIso, parseArgs } from "./lib.mjs";
import { execFileSync } from "node:child_process";

const a = parseArgs();
const ALERT = a.alert || PRIMARY_ALERT;
const TIMEOUT_S = Number(a.timeout) || 240;
const INTERVAL_S = Number(a.interval) || 3;
const prom = a.prom || PROM;

// Precheck: fail fast (~1s) if the prometheus container is not running at all,
// instead of burning the full timeout printing "fetch failed" retries.
const PROM_CONTAINER = a["prom-container"] || "booklogr-prometheus";
try {
  const state = execFileSync(
    "docker", ["inspect", "-f", "{{.State.Running}}", PROM_CONTAINER],
    { encoding: "utf8", timeout: 5000 },
  ).trim();
  if (state !== "true") {
    process.stderr.write(
      `[confirm-fire] FATAL: ${PROM_CONTAINER} container exists but is not running (state=${state})\n` +
      `               Did \`pnpm forge up booklogr\` succeed?\n`,
    );
    process.exit(1);
  }
} catch (e) {
  process.stderr.write(
    `[confirm-fire] FATAL: ${PROM_CONTAINER} container is not running — did \`pnpm forge up booklogr\` succeed?\n`,
  );
  process.exit(1);
}

const started = Date.now();
const deadline = started + TIMEOUT_S * 1000;
process.stderr.write(`[confirm-fire] waiting for '${ALERT}' to fire (timeout ${TIMEOUT_S}s)\n`);

while (Date.now() < deadline) {
  let alerts = [];
  let p99 = null;
  try {
    // one round trip for both, so the logged p99 matches the alert-state read
    [alerts, p99] = await Promise.all([getAlerts(prom), queryScalar(P99_EXPR, prom)]);
  } catch (e) {
    process.stderr.write(`[confirm-fire] prometheus not ready (${e.message}); retrying\n`);
    await sleep(INTERVAL_S * 1000);
    continue;
  }
  const hit = firing(alerts, ALERT);
  const p99s = p99 == null ? "n/a" : `${(p99 * 1000).toFixed(0)}ms`;
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  if (hit) {
    const firedAt = hit.activeAt || nowIso();
    process.stderr.write(`[confirm-fire] FIRING after ${elapsed}s (p99=${p99s})\n`);
    // machine-readable result on stdout
    console.log(JSON.stringify({ ok: true, alert: ALERT, state: "firing", p99_seconds: p99, alert_fired_at: firedAt, elapsed_seconds: Number(elapsed) }));
    process.exit(0);
  }
  process.stderr.write(`[confirm-fire] ${elapsed}s pending… p99=${p99s}\n`);
  await sleep(INTERVAL_S * 1000);
}

process.stderr.write(`[confirm-fire] TIMEOUT after ${TIMEOUT_S}s — '${ALERT}' never fired\n`);
console.log(JSON.stringify({ ok: false, alert: ALERT, reason: "timeout", timeout_seconds: TIMEOUT_S }));
process.exit(1);
