#!/usr/bin/env node
// One-shot status of the booklogr closed loop: current p99 and firing alerts.
//   node scripts/status.mjs [--prom=URL]
import { PROM, P99_EXPR, PRIMARY_ALERT, getAlerts, firingNames, queryScalar, parseArgs } from "./lib.mjs";

const a = parseArgs();
const prom = a.prom || PROM;

try {
  const [alerts, p99] = await Promise.all([getAlerts(prom), queryScalar(P99_EXPR, prom)]);
  const firing = firingNames(alerts);
  process.stdout.write(`prometheus: ${prom}\n`);
  process.stdout.write(`p99 (30s):  ${p99 == null ? "n/a" : `${(p99 * 1000).toFixed(0)}ms`}\n`);
  process.stdout.write(`primary:    ${PRIMARY_ALERT} -> ${firing.includes(PRIMARY_ALERT) ? "FIRING" : "clear"}\n`);
  process.stdout.write(`firing:     ${firing.length ? firing.join(", ") : "(none)"}\n`);
} catch (e) {
  process.stderr.write(`status: prometheus not reachable at ${prom} (${e.message})\n`);
  process.exit(1);
}
