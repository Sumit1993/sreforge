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

const op = process.argv[2];

if (op === "down") {
  console.log(`forge-plane: stopping forge plane...`);
  spawnSync("docker", ["compose", "-f", FORGE_YML, "down"], { stdio: "inherit", cwd: REPO_ROOT });
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
      spawnSync("docker", ["rm", "-f", "sreforge-runner"], { stdio: "ignore" });
    }
  }

  const upArgs = ["compose", "-f", FORGE_YML, "up", "-d"];
  if (!giteaRunning) {
    console.log(`forge-plane: starting gitea and runner...`);
    spawnSync("docker", upArgs, { stdio: "inherit", cwd: REPO_ROOT });
  } else if (!runnerRunning) {
    console.log(`forge-plane: starting act_runner...`);
    spawnSync("docker", [...upArgs, "act_runner"], { stdio: "inherit", cwd: REPO_ROOT });
  } else {
    console.log(`forge-plane: all services running.`);
  }
} else {
  console.error(`forge-plane: unknown operation '${op}'`);
  process.exit(1);
}
