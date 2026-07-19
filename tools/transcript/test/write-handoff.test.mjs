import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../write-handoff.mjs");

// spawnSync, not execFileSync: execFileSync only returns stdout, so stderr on a
// successful (exit 0) run is lost — and the invalid-JSON warning is exactly that
// case. spawnSync gives us both streams regardless of exit code.
function runScript(args) {
  const r = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("missing required arg exits 1", () => {
  const result = runScript(["--out", "/tmp/out.json", "--run-id", "123"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required arguments/);
});

test("invalid session exits 1", () => {
  const result = runScript([
    "--out", "/tmp/out.json",
    "--run-id", "123",
    "--harness", "agy",
    "--session", "hot",
    "--raw-text-file", "/dev/null"
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid session value/);
});

test("raw_text path works", () => {
  const d = mkdtempSync(join(tmpdir(), "sreforge-test-"));
  const txtPath = join(d, "raw.txt");
  const outPath = join(d, "out.json");
  writeFileSync(txtPath, "hello world", "utf8");

  const result = runScript([
    "--out", outPath,
    "--run-id", "run-1",
    "--harness", "agy",
    "--session", "cold",
    "--raw-text-file", txtPath
  ]);
  assert.equal(result.status, 0);

  const out = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(out.run_id, "run-1");
  assert.equal(out.harness, "agy");
  assert.equal(out.session, "cold");
  assert.equal(out.raw_text, "hello world");
  assert.equal(out.raw_json, undefined);
  assert.equal(out.schema_version, "agent-transcript.v1");
  assert.ok(out.captured_at);
});

test("raw_json path works", () => {
  const d = mkdtempSync(join(tmpdir(), "sreforge-test-"));
  const jsonPath = join(d, "raw.json");
  const outPath = join(d, "out.json");
  writeFileSync(jsonPath, JSON.stringify({ a: 1 }), "utf8");

  const result = runScript([
    "--out", outPath,
    "--run-id", "run-2",
    "--harness", "agy",
    "--session", "warm",
    "--model", "test-model",
    "--submitted", "true",
    "--raw-json-file", jsonPath
  ]);
  assert.equal(result.status, 0);

  const out = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(out.run_id, "run-2");
  assert.equal(out.session, "warm");
  assert.equal(out.model, "test-model");
  assert.equal(out.submitted, true);
  assert.deepEqual(out.raw_json, { a: 1 });
  assert.equal(out.raw_text, undefined);
});

test("invalid-JSON fallback to raw_text", () => {
  const d = mkdtempSync(join(tmpdir(), "sreforge-test-"));
  const jsonPath = join(d, "raw.json");
  const outPath = join(d, "out.json");
  writeFileSync(jsonPath, "{ bad json", "utf8");

  const result = runScript([
    "--out", outPath,
    "--run-id", "run-3",
    "--harness", "agy",
    "--session", "cold",
    "--raw-json-file", jsonPath
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /not valid JSON/);
  assert.match(result.stderr, /Falling back to raw_text/);

  const out = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(out.raw_text, "{ bad json");
  assert.equal(out.raw_json, undefined);
});
