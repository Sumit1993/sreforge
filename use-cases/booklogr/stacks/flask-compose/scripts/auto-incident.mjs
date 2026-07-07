#!/usr/bin/env node
// =============================================================================
// auto-incident.mjs — Phase ③ AUTOMATION (ADR-0025): one automated incident
// cycle, self-triggered by the alert push. No resident agent, no harness
// daemon — the use-case's Alertmanager POSTs the firing notification to the
// (per-incident) box, and everything here is verb sequencing:
//
//   1. sandbox up      task agent            (PROVIDER / MCP opt-ins pass through)
//   2. listener up     webhook-wait.mjs      (BEFORE arm — the box "registers")
//   3. arm             task arm              (inject + confirm-fire → AM pushes)
//   4. agent           $AGENT_CMD            (kickoff = the symptom-level payload,
//                                             via WEBHOOK_PAYLOAD; reasoning
//                                             host-side — reasoning-in-box is a
//                                             separate deferred increment)
//   5. grade           task run RUNNER=external  (blocks on the submit sentinel)
//
// AGENT_CMD is a CONFIGURABLE command (harness-agnostic, ADR-0001) run with
// cwd = this stack; default = the reference Ollama driver. The engine is
// untouched: the conductor's one-shot trigger poll stands (the alert is firing
// when `run` starts) and grading is the existing external-runner tail.
//
// Same-session repeats are DEV-MODE (Prometheus history carries the previous
// incident — a repeat-scenario tell); official scoring uses a cold session.
// =============================================================================
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK = resolve(HERE, "..");
const REPO_ROOT = resolve(STACK, "../../../..");
const env = process.env;

const AGENT_CMD = env.AGENT_CMD || "node scripts/agent-ollama.mjs";
const WEBHOOK_PORT = Number(env.WEBHOOK_PORT || 8080);

const TASK_BIN = (() => {
  const local = resolve(REPO_ROOT, "node_modules", ".bin", "task");
  return existsSync(local) ? local : "task";
})();

function task(name, extra = []) {
  console.log(`\nauto ── task ${name} ${extra.join(" ")}`.trimEnd());
  const res = spawnSync(TASK_BIN, ["--dir", STACK, name, ...extra], {
    stdio: "inherit",
    env,
  });
  if (res.status !== 0) {
    console.error(`auto: task ${name} failed (exit ${res.status ?? 1}) — aborting.`);
    process.exit(res.status ?? 1);
  }
}

// Forward the run's opt-ins to `task agent` as task vars (PROVIDER=… MCP=…).
const optIns = ["PROVIDER", "MCP", "EGRESS_ALLOWLIST"]
  .filter((k) => env[k])
  .map((k) => `${k}=${env[k]}`);

// ── 1 · sandbox up (fresh clone + force-recreate: per-incident by construction)
task("agent", optIns);

// ── 2 · listener up BEFORE arm — the box must be reachable when AM notifies.
console.log("\nauto ── webhook listener (in-box, :" + WEBHOOK_PORT + ")");
const listener = spawn("node", [resolve(HERE, "webhook-wait.mjs")], {
  stdio: ["ignore", "pipe", "inherit"],
  env,
});
let payloadJson = "";
listener.stdout.on("data", (d) => (payloadJson += d));
const listenerDone = new Promise((res_) => listener.on("close", res_));

// Wait until the port is actually bound (in-box netstat) so arm cannot race it.
let bound = false;
for (let i = 0; i < 20 && !bound; i++) {
  try {
    execFileSync(
      "docker",
      ["exec", "agent-shell", "sh", "-c", `netstat -tln 2>/dev/null | grep -q ':${WEBHOOK_PORT} '`],
      { stdio: "ignore" },
    );
    bound = true;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!bound) console.error("auto: WARN — could not confirm the listener bound; continuing.");

// ── 3 · arm: inject + confirm-fire. Alertmanager pushes ~group_wait after fire.
task("arm");

// ── 4 · the push: block on the notification, then hand it to the agent driver.
const listenerExit = await listenerDone;
if (listenerExit !== 0 || !payloadJson) {
  console.error(`auto: no webhook notification (listener exit ${listenerExit}) — aborting before the agent.`);
  process.exit(listenerExit || 1);
}
const payload = JSON.parse(payloadJson);
const names = [...new Set((payload.alerts || []).map((a) => a?.labels?.alertname).filter(Boolean))];
console.log(`\nauto ── 🔔 alert push received [${names.join(", ")}] → launching agent`);
console.log(`auto ── agent: ${AGENT_CMD}`);
const agent = spawnSync("sh", ["-c", AGENT_CMD], {
  stdio: "inherit",
  cwd: STACK,
  env: { ...env, WEBHOOK_PAYLOAD: payloadJson },
});
if (agent.status !== 0) {
  console.error(`auto: agent driver exited ${agent.status ?? 1} without a submit — nothing to grade.`);
  process.exit(agent.status ?? 1);
}

// ── 5 · grade (the external runner picks the submit sentinel up immediately).
task("run", ["RUNNER=external"]);
console.log("\nauto ── cycle complete (armed → pushed → agent → graded).");
