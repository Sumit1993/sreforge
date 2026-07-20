#!/usr/bin/env node
import { spawnSync, execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRunnerError } from "../doctor/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FORGE_YML = resolve(REPO_ROOT, "infra/forge/forge.yml");

function isRunning(container) {
  try {
    const out = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function containerExists(container) {
  try {
    execFileSync("docker", ["inspect", container], { stdio: "ignore" });
    return true;
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

function runDocker(args, opts = {}) {
  const res = spawnSync("docker", args, { ...opts, stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0 || res.error) {
    const errText = res.stderr || "";
    const lines = errText.trim().split("\n").filter(Boolean);
    console.error(lines.length > 0 ? lines[lines.length - 1] : (res.error?.message || "Docker command failed"));
    process.exit(res.status || 1);
  }
  if (opts.stdio !== "ignore") {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return res;
}

const op = process.argv[2];

if (op === "down") {
  console.log(`forge-plane: stopping forge plane...`);
  runDocker(["compose", "-f", FORGE_YML, "down"], { stdio: "inherit", cwd: REPO_ROOT });
} else if (op === "up") {
  const giteaRunning = isRunning("sreforge-gitea");
  
  if (giteaRunning) {
    console.log(`forge-plane: sreforge-gitea is running, leaving it alone`);
  }
  
  let runnerRunning = isRunning("sreforge-runner");
  
  if (!runnerRunning && containerExists("sreforge-runner")) {
    const err = getStartError("sreforge-runner");
    if (classifyRunnerError(err) === "stale-shim" || err) {
      console.log(`forge-plane: runner won't start or has stale shim. recreating sreforge-runner...`);
      runDocker(["rm", "-f", "sreforge-runner"], { stdio: "ignore" });
    }
  }

  const upArgs = ["compose", "-f", FORGE_YML, "up", "-d"];
  if (!giteaRunning) {
    console.log(`forge-plane: starting gitea and runner...`);
    runDocker(upArgs, { stdio: "inherit", cwd: REPO_ROOT });
  } else if (!runnerRunning) {
    console.log(`forge-plane: starting act_runner...`);
    runDocker([...upArgs, "act_runner"], { stdio: "inherit", cwd: REPO_ROOT });
  } else {
    console.log(`forge-plane: all services running.`);
  }
} else {
  console.error(`forge-plane: unknown operation '${op}'`);
  process.exit(1);
}
