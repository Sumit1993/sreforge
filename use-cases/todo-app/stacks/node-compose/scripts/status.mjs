#!/usr/bin/env node
// Quick stack status: live p99 latency + any firing alerts. Read-only.
//   node scripts/status.mjs [--prom=URL]
import { PROM, P99_EXPR, getAlerts, firingNames, queryScalar, parseArgs } from "./lib.mjs";

const a = parseArgs();
const prom = a.prom || PROM;

const p99 = await queryScalar(P99_EXPR, prom).catch(() => null);
let alerts = [];
try {
  alerts = await getAlerts(prom);
} catch (e) {
  console.log(`prometheus not reachable: ${e.message}`);
  process.exit(0);
}
const firing = firingNames(alerts);
const pending = [...new Set(alerts.filter((x) => x.state === "pending").map((x) => x.labels?.alertname))];

console.log(`p99 latency : ${p99 == null ? "n/a" : (p99 * 1000).toFixed(0) + "ms"}`);
console.log(`firing      : ${firing.length ? firing.join(", ") : "(none)"}`);
console.log(`pending     : ${pending.length ? pending.join(", ") : "(none)"}`);
