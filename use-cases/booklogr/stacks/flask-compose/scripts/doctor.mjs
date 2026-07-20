#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChecks, runAllChecks, summarize, resolveRepoRoot } from "../../../../../tools/doctor/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK = resolve(HERE, "..");
const USECASE = resolve(STACK, "../..");
const REPO_ROOT = resolveRepoRoot(USECASE);

// Read env directly instead of relying on Taskfile dotenv so it can run if missing
let envContent = "";
const envPath = resolve(STACK, ".env");
if (existsSync(envPath)) {
  envContent = readFileSync(envPath, "utf8");
}
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const config = {
  giteaLocalhostUrl: "http://localhost:3000",
  gitea127Url: (() => { const u = new URL(env.GITEA_URL || "http://127.0.0.1:3000"); u.hostname = "127.0.0.1"; return u.href; })(),
  giteaAdminUser: env.GITEA_ADMIN_USER || "sreforge",
  giteaAdminPass: env.GITEA_ADMIN_PASSWORD || "change-me-locally",
  giteaMaintUser: env.GITEA_MAINT_USER || "maintainer",
  giteaMaintPass: env.GITEA_MAINT_PASS || "maintainer",
  giteaOwner: env.GITEA_REPO_OWNER || "booklogr",
  giteaRepo: env.GITEA_REPO_NAME || "booklogr",
  runnerContainer: "sreforge-runner",
  giteaContainer: "sreforge-gitea",
  envPath,
  exampleEnvPath: resolve(STACK, ".env.example"),
  substratePath: resolve(REPO_ROOT, "substrate/booklogr"),
  coreNodeModulesPath: resolve(REPO_ROOT, "core/node_modules"),
  coreDistPath: resolve(REPO_ROOT, "core/dist"),
  rootNodeModulesPath: resolve(REPO_ROOT, "node_modules"),
  deployServices: ["booklogr-db", "booklogr-api", "booklogr-web", "booklogr-prometheus", "booklogr-alertmanager", "booklogr-grafana", "book-metadata"],
  prometheusUrl: env.PROM_URL || "http://localhost:9090",
  alertmanagerUrl: "http://localhost:9093",
  deployUpHint: "pnpm forge up booklogr"
};

const checks = defineChecks(config);

async function main() {
  const results = await runAllChecks(checks);
  const { lines, exitCode } = summarize(results);
  for (const line of lines) {
    console.log(line);
  }
  process.exit(exitCode);
}

main();
