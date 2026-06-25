#!/usr/bin/env node
// run-incident.mjs — drive ONE booklogr incident run end-to-end through the
// SREForge engine, with a scripted reference fix standing in for the agent
// (M5 is parked). This is the conductor automation for the latency-cache-stampede
// scenario: it wires the booklogr-specific config into the domain-agnostic
// @sreforge/core Conductor and runs:
//
//   trigger(Prometheus alert firing) -> assemble brief -> ScriptedFixAgentRunner
//   (apply solution/fix.patch, branch, push, open PR) -> GiteaCiGate (poll the
//   forge Actions run for HEAD) -> GiteaAutoMerge (merge the PR) ->
//   ComposeCdDeployer (rebuild+swap booklogr-api) -> MitigationOracle (clear +
//   sustained-clear under STILL-ACTIVE storm) -> FileRunRecorder -> ComposeCleanup
//   (reset workspace to origin/baseline + redeploy regressed).
//
// PRECONDITION: the incident must already be live (regressed deploy + storm +
// the alert FIRING). Arm it first (inject-regression.sh + up + k6 + confirm-fire).
// The conductor's trigger.poll() throws if the alert is not firing at t=0.
//
// Config comes from the environment (source .env first). Override the fix for a
// negative/anti-cheat run with --patch / --message.
//
// Usage:
//   set -a; source ../../.env; set +a            # GITEA_TOKEN, owner/repo, urls
//   node run-incident.mjs                          # positive: reference fix
//   node run-incident.mjs --patch /abs/bad.patch --message "WIP" --scenario-id neg

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import fs from "node:fs";
import {
  runIncident,
  PrometheusAlertTrigger,
  ContextAssembler,
  ScriptedFixAgentRunner,
  ExternalAgentRunner,
  GiteaClient,
  GiteaCiGate,
  GiteaAutoMerge,
  ComposeCdDeployer,
  MitigationOracle,
  PrometheusAlertProbe,
  FileRunRecorder,
  ComposeCleanup,
} from "../../../../../core/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK = resolve(HERE, ".."); // .../stacks/flask-compose
const REPO_ROOT = resolve(STACK, "../../../.."); // repo root

// ---- tiny arg parser ------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ---- config (env with localhost defaults) ---------------------------------
const env = process.env;
const GITEA_URL = env.GITEA_URL || "http://localhost:3000";
const TOKEN = env.GITEA_TOKEN;
const OWNER = env.GITEA_REPO_OWNER || "booklogr";
const REPO = env.GITEA_REPO_NAME || "booklogr";
const PROM_URL = env.PROM_URL || "http://localhost:9090";
const ALERT = env.ALERT || "BooklogrApiLatencyP99High";
const SERVICE = env.SERVICE || "booklogr-api";
const PROJECT = env.COMPOSE_PROJECT || "booklogr";
// Deploy from a NEUTRAL symlink so docker-inspect project labels don't leak the
// harness path (mirrors scripts/lib-deploy.sh). The symlink target is invisible
// to the agent; only the neutral path appears in com.docker.compose.project.*.
function resolveDeployDir(stack) {
  for (const c of [process.env.SREFORGE_DEPLOY_DIR, "/srv/booklogr", join(homedir(), "srv/booklogr")].filter(Boolean)) {
    try {
      fs.mkdirSync(dirname(c), { recursive: true });
      try { fs.symlinkSync(stack, c); } catch (e) { if (e.code !== "EEXIST") throw e; }
      if (fs.realpathSync(c) === fs.realpathSync(stack)) return c;
    } catch { /* try next candidate */ }
  }
  return stack;
}
const COMPOSE_FILE = resolve(resolveDeployDir(STACK), "compose/docker-compose.yml");
const WORKSPACE = resolve(STACK, "substrate/booklogr");
// Local branch, not origin/baseline: the baseline anchor is kept host-side only
// so the agent-visible forge never carries a `baseline` branch (de-tell). The
// cleanup's `git reset --hard <ref>` resolves it from the local workspace.
const BASELINE_REF = env.BASELINE_REF || "baseline";

if (!TOKEN) {
  console.error("FATAL: GITEA_TOKEN is not set. Run `set -a; source .env; set +a` first.");
  process.exit(2);
}

const runId = arg("run-id", `run-${Date.now()}`);
const scenarioId = arg("scenario-id", "latency-cache-stampede");
const patchPath = resolve(
  arg("patch", join(REPO_ROOT, "use-cases/booklogr/scenarios/latency-cache-stampede/solution/fix.patch")),
);
const commitMessage = arg("message", "Restore response cache for book search");
const recordDir = resolve(arg("record-dir", join(STACK, "runs")));

// Pass threshold 0.85 separates a valid sustained clear (>=0.90) from a fix that
// clears briefly but does not survive the active storm (<=0.80) — the three hard
// signals (ci 0.25 + cleared 0.35 + sustained 0.20 = 0.80) plus a sliver of the
// soft credit (time-to-clear / no-new-alerts) are required to pass.
const PASS_THRESHOLD = Number(env.PASS_THRESHOLD || 0.85);
const MAX_CLEAR_SECONDS = Number(env.MAX_CLEAR_SECONDS || 180);
const SUSTAINED_CLEAR_SECONDS = Number(env.SUSTAINED_CLEAR_SECONDS || 30);

const client = new GiteaClient({ baseUrl: GITEA_URL, token: TOKEN, owner: OWNER, repo: REPO });

// ---- runner mode (OPT-IN; default = scripted, fully backward compatible) ----
// scripted (default): ScriptedFixAgentRunner replays the canned solution/fix.patch.
// external           : ExternalAgentRunner picks up a REAL agent's submission from
//                      the de-tell'd clean workspace (.run-workspace/booklogr, the
//                      host side of the sandbox /workspace mount) — it waits for the
//                      submit sentinel, captures the agent's diff, and replays it onto
//                      the forge substrate exactly as the scripted runner replays a
//                      patch. Both flags are accepted (AGENT_MODE per design, RUNNER
//                      per the task) so either spelling works.
const AGENT_MODE = (env.AGENT_MODE || env.RUNNER || "scripted").toLowerCase();
const CLEAN_WORKSPACE = resolve(STACK, ".run-workspace/booklogr");

// Both runners author the substrate fix commit under the project's own identity,
// consistent with the rest of the forge history.
const AUTHOR_NAME = "Andreas Backström";
const AUTHOR_EMAIL = "mozzo242@gmail.com";

const runner =
  AGENT_MODE === "external"
    ? new ExternalAgentRunner({
        client,
        // The agent edits the CLEAN clone; the runner replays its diff onto the
        // substrate (config.agentContext.runWorkspace.path, unchanged below).
        cleanWorkspacePath: CLEAN_WORKSPACE,
        branch: `fix/${runId}`,
        base: "main",
        commitMessage,
        authorName: AUTHOR_NAME,
        authorEmail: AUTHOR_EMAIL,
      })
    : new ScriptedFixAgentRunner({
        client,
        patchPath,
        branch: `fix/${runId}`,
        base: "main",
        commitMessage,
        authorName: AUTHOR_NAME,
        authorEmail: AUTHOR_EMAIL,
      });

const deps = {
  trigger: new PrometheusAlertTrigger({ prometheusUrl: PROM_URL, alertName: ALERT }),
  assembler: new ContextAssembler(),
  runner,
  ciGate: new GiteaCiGate({ client, pollIntervalMs: 5_000, timeoutMs: 600_000 }),
  autoMerge: new GiteaAutoMerge({ client }),
  deployer: new ComposeCdDeployer({ composeFile: COMPOSE_FILE, projectName: PROJECT, timeoutMs: 300_000 }),
  oracle: new MitigationOracle({
    probe: new PrometheusAlertProbe({ prometheusUrl: PROM_URL }),
    passThreshold: PASS_THRESHOLD,
  }),
  recorder: new FileRunRecorder({ baseDir: recordDir }),
  cleanup: new ComposeCleanup({
    composeFile: COMPOSE_FILE,
    projectName: PROJECT,
    baselineRef: BASELINE_REF,
  }),
};

const config = {
  runId,
  scenarioId,
  profile: "incident",
  expectedAlert: ALERT,
  agentContext: {
    services: {
      prometheus: PROM_URL,
      alertmanager: env.ALERTMANAGER_URL || "http://localhost:9093",
      grafana: env.GRAFANA_URL || "http://localhost:3002",
      "booklogr-api": env.API_URL || "http://localhost:5000",
    },
    // runWorkspace stays the SUBSTRATE in both modes: the conductor's CI / merge
    // / redeploy / cleanup all key off it, and that is exactly where both runners
    // land the fix. (External mode's clean-workspace path is a runner-internal
    // input, not part of agentContext.)
    runWorkspace: { path: WORKSPACE, service: SERVICE },
    // The brief must name the EXACT command the agent's environment provides.
    // In external mode the sandbox shim is `submit` (SUBMIT_CMD in agent.yml);
    // the scripted path is engine-internal, so its value is informational only.
    submitCommand: AGENT_MODE === "external" ? "submit" : "sreforge submit",
  },
  mitigation: {
    alertToClear: ALERT,
    maxClearTimeSeconds: MAX_CLEAR_SECONDS,
    sustainedClearSeconds: SUSTAINED_CLEAR_SECONDS,
  },
  recordDir,
};

console.log(`[run-incident] runId=${runId} scenario=${scenarioId} mode=${AGENT_MODE}`);
console.log(`[run-incident] forge=${GITEA_URL} repo=${OWNER}/${REPO} alert=${ALERT}`);
if (AGENT_MODE === "external") {
  console.log(`[run-incident] cleanWorkspace=${CLEAN_WORKSPACE} (awaiting agent submit sentinel)`);
} else {
  console.log(`[run-incident] patch=${patchPath}`);
}
console.log(`[run-incident] workspace=${WORKSPACE} service=${SERVICE} compose=${COMPOSE_FILE}`);
console.log(`[run-incident] passThreshold=${PASS_THRESHOLD} maxClear=${MAX_CLEAR_SECONDS}s sustained=${SUSTAINED_CLEAR_SECONDS}s`);

const { record, recordPath } = await runIncident(config, deps);

console.log("\n========== RESULT ==========");
console.log(`verdict : ${record.verdict}`);
console.log(`score   : ${record.score.score.toFixed(3)} (threshold ${PASS_THRESHOLD}, passed=${record.score.passed})`);
for (const s of record.score.signals) {
  console.log(`  - ${s.id.padEnd(16)} value=${Number(s.value).toFixed(2)} weight=${s.weight}  ${s.detail}`);
}
console.log(`ci      : ${record.ci ? `green=${record.ci.green}` : "n/a"}`);
console.log(`deploy  : ${record.deploy ? `redeployed=${record.deploy.redeployed}` : "n/a"}`);
console.log("timings :", JSON.stringify(record.timings));
console.log(`record  : ${recordPath}`);

// Exit non-zero on a non-passing verdict so smoke scripts can assert.
process.exit(record.verdict === "passed" ? 0 : 1);
