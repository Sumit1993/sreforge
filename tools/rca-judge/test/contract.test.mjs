import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { SCHEMA_VERSION } from "../judge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const JUDGE = resolve(HERE, "../judge.mjs");
const FIX = resolve(HERE, "fixtures");
const oracleMd = readFileSync(join(FIX, "oracle.md"), "utf8");

function tmp() { return mkdtempSync(join(tmpdir(), "rca-judge-contract-")); }
function runCli(args, env = {}) {
  const r = spawnSync("node", [JUDGE, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { exit: r.status, out: `${r.stdout || ""}`, err: `${r.stderr || ""}` };
}

// ── Contract tests: pinned interface for prismalens (sreforge#155) ────────────

test("contract: oracle resolution requires exactly <scenario>/verify/oracle.md", () => {
  // Case 1: valid layout <dir>/verify/oracle.md succeeds
  const validScenario = tmp();
  mkdirSync(join(validScenario, "verify"), { recursive: true });
  writeFileSync(join(validScenario, "verify", "oracle.md"), oracleMd, "utf8");

  const out = tmp();
  const rcaFile = join(out, "rca.txt");
  writeFileSync(rcaFile, "RCA content", "utf8");

  const rValid = runCli(["--prepare", "--rca-file", rcaFile, "--scenario", validScenario, "--out", out]);
  assert.equal(rValid.exit, 0);
  const prompt = readFileSync(join(out, "judge-input.md"), "utf8");
  assert.match(prompt, /CACHE_TYPE=NullCache/);

  // Case 2: oracle placed at top-level <dir>/oracle.md instead of verify/ is NOT resolved
  const invalidScenario = tmp();
  writeFileSync(join(invalidScenario, "oracle.md"), oracleMd, "utf8");

  const rInvalid = runCli(["--prepare", "--rca-file", rcaFile, "--scenario", invalidScenario, "--out", tmp()]);
  assert.equal(rInvalid.exit, 2);
  const expectedMissingPath = join(invalidScenario, "verify", "oracle.md");
  assert.match(rInvalid.err, new RegExp(`oracle not found: ${expectedMissingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("contract: missing or moved verify/oracle.md exits 2 and names the exact path", () => {
  const emptyScenario = tmp();
  const out = tmp();
  const rcaFile = join(out, "rca.txt");
  writeFileSync(rcaFile, "RCA content", "utf8");

  const r = runCli(["--prepare", "--rca-file", rcaFile, "--scenario", emptyScenario, "--out", out]);
  assert.equal(r.exit, 2);
  const expectedPath = join(emptyScenario, "verify", "oracle.md");
  assert.ok(
    r.err.includes(`oracle not found: ${expectedPath}`),
    `stderr should name missing path ${expectedPath}, got: ${r.err}`,
  );
});

test("contract: malformed oracle missing root cause section exits 2 and identifies missing section", () => {
  const scenario = tmp();
  mkdirSync(join(scenario, "verify"), { recursive: true });
  const badOracle = readFileSync(join(FIX, "oracle-no-root-cause.md"), "utf8");
  writeFileSync(join(scenario, "verify", "oracle.md"), badOracle, "utf8");

  const out = tmp();
  const rcaFile = join(out, "rca.txt");
  writeFileSync(rcaFile, "RCA content", "utf8");

  const r = runCli(["--prepare", "--rca-file", rcaFile, "--scenario", scenario, "--out", out]);
  assert.equal(r.exit, 2);
  assert.match(r.err, /## Root cause \(harness-internal\)/);
  assert.match(r.err, /oracle\.md has no "## Root cause \(harness-internal\)" section/);
});

test("contract: exit 2 (contract violation) is distinguishable from exit 0 (model unreachable)", () => {
  const scenario = tmp();
  mkdirSync(join(scenario, "verify"), { recursive: true });
  writeFileSync(join(scenario, "verify", "oracle.md"), oracleMd, "utf8");

  const out = tmp();
  const rcaFile = join(out, "rca.txt");
  writeFileSync(rcaFile, "RCA content", "utf8");

  // Contract violation: RCA_JUDGE_MODEL unset -> exit 2
  const rViolation = runCli(
    ["--judge", "--rca-file", rcaFile, "--scenario", scenario, "--out", out],
    { RCA_JUDGE_MODEL: "" },
  );
  assert.equal(rViolation.exit, 2);
  assert.match(rViolation.err, /RCA_JUDGE_MODEL is not set/);

  // Model unreachable: RCA_JUDGE_MODEL set, unreachable host -> exit 0, no diagnosis written
  const outUnreachable = tmp();
  const rUnreachable = runCli(
    ["--judge", "--rca-file", rcaFile, "--scenario", scenario, "--out", outUnreachable],
    { RCA_JUDGE_MODEL: "test-judge-model", OLLAMA_HOST: "http://127.0.0.1:1" },
  );
  assert.equal(rUnreachable.exit, 0);
  assert.match(rUnreachable.err, /judge model unreachable\/failed/);
  assert.ok(!existsSync(join(outUnreachable, "diagnosis.json")));

  // Distinguishable exit codes
  assert.notEqual(rViolation.exit, rUnreachable.exit);
});

test("contract: --grade writes diagnosis.json with literal schema_version 'diagnosis.v1'", () => {
  const out = tmp();
  const r = runCli([
    "--grade", join(FIX, "verdict-decoy-false-lead.json"),
    "--out", out,
    "--run-id", "test-run",
    "--scenario-id", "test-scenario",
    "--judge-model", "test-model",
  ]);
  assert.equal(r.exit, 0);

  const diagnosisPath = join(out, "diagnosis.json");
  assert.ok(existsSync(diagnosisPath));
  const diagnosis = JSON.parse(readFileSync(diagnosisPath, "utf8"));

  assert.equal(diagnosis.schema_version, "diagnosis.v1");
  assert.equal(SCHEMA_VERSION, "diagnosis.v1");
});
