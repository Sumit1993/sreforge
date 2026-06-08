#!/usr/bin/env node
// SREForge confirm-fire gate (D10).
//
// Polls Prometheus until the expected alert is firing, within a timeout. This
// guarantees the agent is only ever handed a genuine, reproduced incident —
// never a non-incident. Prints the alert_fired_at timestamp on success.
//
//   node scripts/confirm-fire.mjs [--alert=TodoApiLatencyP99High]
//                                 [--timeout=240] [--interval=3] [--prom=URL]
//
// Exit 0 = alert firing (incident confirmed); exit 1 = timed out.

import { PROM, P99_EXPR, getAlerts, firing, queryScalar, sleep, nowIso, parseArgs } from "./lib.mjs";

const a = parseArgs();
const ALERT = a.alert || "TodoApiLatencyP99High";
const TIMEOUT_S = Number(a.timeout) || 240;
const INTERVAL_S = Number(a.interval) || 3;
const prom = a.prom || PROM;

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
