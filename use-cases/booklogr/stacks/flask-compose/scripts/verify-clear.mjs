#!/usr/bin/env node
// Mitigation oracle — sustained-clear check for the booklogr stack.
//
// Run immediately after the fix is redeployed, while the storm load is STILL
// running. Verifies the alert clears and stays cleared for `sustain` seconds,
// records time-to-clear, and checks no other alert is firing. This is the
// behavioural anti-cheat: the alert can only clear because the deployed fix
// actually works under the still-active fault.
//
//   node scripts/verify-clear.mjs [--alert=BooklogrApiLatencyP99High]
//                                 [--sustain=30] [--timeout=180]
//                                 [--interval=3] [--prom=URL]
//
// Exit 0 = cleared & sustained (PASS); exit 1 = still firing at timeout (FAIL).

import { PROM, P99_EXPR, PRIMARY_ALERT, getAlerts, firing, firingNames, queryScalar, sleep, parseArgs } from "./lib.mjs";

const a = parseArgs();
const ALERT = a.alert || PRIMARY_ALERT;
const SUSTAIN_S = Number(a.sustain) || 30;
const TIMEOUT_S = Number(a.timeout) || 180;
const INTERVAL_S = Number(a.interval) || 3;
const prom = a.prom || PROM;

const started = Date.now();
const deadline = started + TIMEOUT_S * 1000;
process.stderr.write(`[verify-clear] waiting for '${ALERT}' to clear and stay clear ${SUSTAIN_S}s (timeout ${TIMEOUT_S}s)\n`);

let clearedAt = null; // ms timestamp when it first went clear

while (Date.now() < deadline) {
  let alerts = [];
  let p99 = null;
  try {
    [alerts, p99] = await Promise.all([getAlerts(prom), queryScalar(P99_EXPR, prom)]);
  } catch {
    await sleep(INTERVAL_S * 1000);
    continue;
  }
  const stillFiring = firing(alerts, ALERT);
  const p99s = p99 == null ? "n/a" : `${(p99 * 1000).toFixed(0)}ms`;
  const others = firingNames(alerts).filter((n) => n !== ALERT);

  if (stillFiring) {
    clearedAt = null; // reset the sustain window if it re-fires
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    process.stderr.write(`[verify-clear] ${elapsed}s still firing… p99=${p99s}\n`);
  } else {
    if (clearedAt == null) {
      clearedAt = Date.now();
      process.stderr.write(`[verify-clear] cleared (p99=${p99s}); holding for ${SUSTAIN_S}s\n`);
    }
    const heldFor = (Date.now() - clearedAt) / 1000;
    if (heldFor >= SUSTAIN_S) {
      const ttc = Math.round((clearedAt - started) / 1000);
      process.stderr.write(`[verify-clear] PASS — cleared & sustained ${SUSTAIN_S}s (time-to-clear ${ttc}s)\n`);
      console.log(JSON.stringify({ ok: true, alert: ALERT, cleared: true, time_to_clear_seconds: ttc, sustained_seconds: SUSTAIN_S, other_firing: others, p99_seconds: p99 }));
      process.exit(0);
    }
    process.stderr.write(`[verify-clear] holding clear ${heldFor.toFixed(0)}/${SUSTAIN_S}s (p99=${p99s})\n`);
  }
  await sleep(INTERVAL_S * 1000);
}

process.stderr.write(`[verify-clear] FAIL — '${ALERT}' did not stay cleared within ${TIMEOUT_S}s\n`);
console.log(JSON.stringify({ ok: false, alert: ALERT, cleared: false, reason: "timeout", timeout_seconds: TIMEOUT_S }));
process.exit(1);
