import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "../lint.mjs");
const REPO_ROOT = resolve(HERE, "../../..");

const SECRET = "SUPER-SECRET-TRANSCRIPT-SENTINEL";

function writeRecord(obj) {
  const dir = mkdtempSync(join(tmpdir(), "record-lint-"));
  const path = join(dir, "run-1.json");
  writeFileSync(path, JSON.stringify(obj, null, 2));
  return path;
}

const PRUNED = {
  record_version: 1,
  kind: "run-record",
  run_id: "run-1",
  scenario_id: "demo",
  verdict: "passed",
  full_record_sha256: "a".repeat(64),
  trajectory: { steps: 3 },
  agent_transcript: {
    schema_version: "agent-transcript.v1",
    run_id: "run-1",
    harness: "agy",
    session: "cold",
    confinement: "host-sandboxed",
    captured_at: "2026-07-27T17:32:56.564Z",
    model: "Gemini 3.6 Flash (High)",
    provider: "antigravity",
    submitted: true,
  },
};

function runLint(paths) {
  return execFileSync("node", [SCRIPT, ...paths], { encoding: "utf8" });
}

function runLintExpectingFailure(paths) {
  try {
    runLint(paths);
    assert.fail("expected record-lint to exit non-zero");
  } catch (err) {
    assert.equal(err.status, 1, `expected exit 1, got ${err.status}`);
    return err;
  }
}

test("1. pruned record passes — the public-eligible form is not flagged", () => {
  const out = runLint([writeRecord(PRUNED)]);
  assert.match(out, /Scanned 1 tracked record\(s\)/);
  assert.match(out, /No transcript-bearing records/);
});

test("2. trajectory.transcript makes a record full — rejected", () => {
  const rec = { ...PRUNED, trajectory: { steps: 3, transcript: `${SECRET} blah blah` } };
  const err = runLintExpectingFailure([writeRecord(rec)]);
  assert.match(err.stderr, /1 transcript-bearing record\(s\)/);
  assert.match(err.stderr, /ADR-0026 §7/);
});

test("3. agent_transcript payload key makes a record full — rejected", () => {
  const rec = { ...PRUNED, agent_transcript: { ...PRUNED.agent_transcript, raw_text: SECRET } };
  const err = runLintExpectingFailure([writeRecord(rec)]);
  assert.match(err.stderr, /1 transcript-bearing record\(s\)/);
});

test("4. any non-header key in agent_transcript makes a record full — rejected", () => {
  const rec = { ...PRUNED, agent_transcript: { ...PRUNED.agent_transcript, events: [{ role: "user" }] } };
  runLintExpectingFailure([writeRecord(rec)]);
});

test("5. empty-string transcript is not payload — pruned records with the key still pass", () => {
  const rec = { ...PRUNED, trajectory: { steps: 3, transcript: "   " } };
  const out = runLint([writeRecord(rec)]);
  assert.match(out, /No transcript-bearing records/);
});

test("6. no-content-leak — output names the path but never echoes transcript content", () => {
  const rec = { ...PRUNED, trajectory: { steps: 3, transcript: `${SECRET} blah blah` } };
  const err = runLintExpectingFailure([writeRecord(rec)]);
  const combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  assert.ok(!combined.includes(SECRET), "lint output leaked transcript content into CI logs");
});

test("7. multiple offenders are all reported", () => {
  const a = writeRecord({ ...PRUNED, trajectory: { steps: 1, transcript: "x" } });
  const b = writeRecord({ ...PRUNED, agent_transcript: { ...PRUNED.agent_transcript, raw_json: "{}" } });
  const err = runLintExpectingFailure([a, b]);
  assert.match(err.stderr, /2 transcript-bearing record\(s\)/);
});

test("8. the real repo is clean — no tracked record in this repo is transcript-bearing", () => {
  const out = execFileSync("node", [SCRIPT], { encoding: "utf8", cwd: REPO_ROOT });
  assert.match(out, /No transcript-bearing records in the public repo/);
});
