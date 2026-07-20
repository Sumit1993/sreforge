import { execFileSync, execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROM, P99_EXPR, PRIMARY_ALERT, getAlerts, firingNames, queryScalar, parseArgs } from "./lib.mjs";
import { classifyRunnerError } from "../../../../../tools/doctor/lib.mjs";

const execFile = promisify(_execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const STACK = resolve(HERE, "..");

function isRunning(container) {
  try {
    const out = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function getStartError(container) {
  try {
    const out = execFileSync("docker", ["inspect", "-f", "{{.State.Error}}", container], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out;
  } catch {
    return "";
  }
}

const deployServices = ["booklogr-db", "booklogr-api", "booklogr-web", "booklogr-prometheus", "booklogr-alertmanager", "booklogr-grafana", "book-metadata"];
let deployHealthy = 0;
await Promise.all(deployServices.map(async (svc) => {
  try {
    const { stdout } = await execFile("docker", ["inspect", "-f", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", svc], { encoding: "utf8", timeout: 5000 });
    const out = stdout.trim();
    if (out === "running healthy" || out === "running none") {
      deployHealthy++;
    }
  } catch {}
}));

const giteaOk = isRunning("sreforge-gitea");
const runnerOk = isRunning("sreforge-runner");
let runnerHint = "";
if (!runnerOk) {
  const err = getStartError("sreforge-runner");
  if (classifyRunnerError(err) === "stale-shim") runnerHint = " (stale shim)";
}

const agentWorkspace = existsSync(resolve(STACK, ".run-workspace", "booklogr"));

let exitCode = 0;
if (!giteaOk || !runnerOk || deployHealthy !== deployServices.length) {
  exitCode = 1;
}

process.stdout.write(`[forge plane]  gitea: ${giteaOk ? "running" : "DOWN"}\n`);
process.stdout.write(`[forge plane]  runner: ${runnerOk ? "running" : "DOWN"}${runnerHint}`);
if (!giteaOk || !runnerOk) {
  process.stdout.write(`  hint: pnpm forge forge-up`);
}
process.stdout.write("\n");

process.stdout.write(`[deploy plane] services: ${deployHealthy}/${deployServices.length} healthy\n`);

process.stdout.write(`[agent rig]    workspace: ${agentWorkspace ? "present" : "missing"}\n`);

const a = parseArgs();
const prom = a.prom || PROM;

try {
  const [alerts, p99] = await Promise.race([
    Promise.all([getAlerts(prom), queryScalar(P99_EXPR, prom)]),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))
  ]);
  const firing = firingNames(alerts);
  process.stdout.write(`[alerting]     p99 (30s):  ${p99 == null ? "n/a" : `${(p99 * 1000).toFixed(0)}ms`}\n`);
  process.stdout.write(`[alerting]     primary:    ${PRIMARY_ALERT} -> ${firing.includes(PRIMARY_ALERT) ? "FIRING" : "clear"}\n`);
  process.stdout.write(`[alerting]     firing:     ${firing.length ? firing.join(", ") : "(none)"}\n`);
} catch (e) {
  process.stdout.write(`[alerting]     prometheus: unreachable (${e.message})\n`);
  exitCode = 1;
}

process.exit(exitCode);
