import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "../migrate-run-records.mjs");

function tmp() {
  return mkdtempSync(join(tmpdir(), "sreforge-migrate-"));
}

const dummyRecord = {
  runId: "run-123",
  scenarioId: "scenario-1",
  profile: "incident",
  trigger: {
    source: "prom",
    alertName: "HighErrorRate",
    severity: "critical",
    labels: { app: "foo" },
    annotations: { desc: "bar" },
    firedAt: "2023-01-01T00:00:00Z",
  },
  trajectory: {
    agentName: "agent-1",
    transcript: "hello",
    diff: "diff1",
    submitted: true,
    durationMs: 100,
  },
  diff: "diff1",
  ci: null,
  deploy: null,
  score: {
    oracleId: "main",
    score: 1.0,
    passed: true,
    signals: [],
  },
  verdict: "passed",
  timings: {},
  startedAt: "2023-01-01T00:00:00Z",
  finishedAt: "2023-01-01T00:01:00Z",
};

test("migrates camelCase record to snake_case with embedded transcript", () => {
  const dir = tmp();
  const runDir = join(dir, "run-123");
  mkdirSync(runDir);
  
  writeFileSync(join(runDir, "record.json"), JSON.stringify(dummyRecord));
  writeFileSync(join(runDir, "agent-transcript.json"), JSON.stringify({ handoff: true }));

  const missingDir = join(dir, "run-missing");
  mkdirSync(missingDir);
  const missingRecord = { ...dummyRecord };
  delete missingRecord.runId;
  writeFileSync(join(missingDir, "record.json"), JSON.stringify(missingRecord));

  // Run dry run
  const out1 = execFileSync("node", [SCRIPT, "--runs-dir", dir, "--dry-run"], { encoding: "utf8" });
  assert.match(out1, /Would migrate run-123/);
  assert.match(out1, /1 migrated, 1 skipped/);
  
  // Verify it didn't write
  const raw1 = JSON.parse(readFileSync(join(runDir, "record.json")));
  assert.equal(raw1.runId, "run-123");
  
  const rawMissing1 = JSON.parse(readFileSync(join(missingDir, "record.json")));
  assert.deepEqual(rawMissing1, missingRecord);

  // Run real
  const out2 = execFileSync("node", [SCRIPT, "--runs-dir", dir], { encoding: "utf8" });
  assert.match(out2, /\[migrated\] run-123/);
  assert.match(out2, /Schema valid count: 1/);
  assert.match(out2, /1 migrated, 1 skipped/);
  
  // Verify it wrote snake_case
  const raw2 = JSON.parse(readFileSync(join(runDir, "record.json")));
  assert.equal(raw2.runId, undefined);
  assert.equal(raw2.run_id, "run-123");
  assert.deepEqual(raw2.agent_transcript, { handoff: true });
  assert.equal(raw2.record_version, "1.0.0");
  
  // Verify missing was left unmodified
  const rawMissing2 = JSON.parse(readFileSync(join(missingDir, "record.json")));
  assert.deepEqual(rawMissing2, missingRecord);
  
  // Second run is no-op
  const out3 = execFileSync("node", [SCRIPT, "--runs-dir", dir], { encoding: "utf8" });
  assert.match(out3, /\[skip\] run-123 is already migrated/);
  assert.match(out3, /Schema valid count: 1/);
  assert.match(out3, /0 migrated, 2 skipped/);
});
