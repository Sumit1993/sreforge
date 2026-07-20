import test from "node:test";
import assert from "node:assert/strict";
import {
  toDiskRecord,
  fromDiskRecord,
  serializeDiskRecord,
  pruneDiskRecord,
} from "../dist/record/serialize.js";
import { createHash } from "node:crypto";

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
  ci: {
    green: true,
    output: "ok",
    exitCode: 0,
    durationMs: 200,
  },
  deploy: {
    redeployed: true,
    service: "web",
    durationMs: 300,
  },
  score: {
    oracleId: "main",
    score: 1.0,
    passed: true,
    signals: [
      { id: "s1", satisfied: true, value: 1.0, weight: 1.0, detail: "ok" }
    ],
  },
  verdict: "passed",
  timings: {
    run: 100,
  },
  startedAt: "2023-01-01T00:00:00Z",
  finishedAt: "2023-01-01T00:01:00Z",
};

test("serialize round-trip", () => {
  const disk = toDiskRecord(dummyRecord, { test_transcript: true });
  assert.equal(disk.record_version, "1.0.0");
  assert.equal(disk.kind, "run-record");
  assert.equal(disk.run_id, "run-123");
  assert.equal(disk.trigger.alert_name, "HighErrorRate");
  assert.equal(disk.trajectory.agent_name, "agent-1");
  assert.deepEqual(disk.agent_transcript, { test_transcript: true });

  const restored = fromDiskRecord(disk);
  assert.deepEqual(restored, dummyRecord);
});

test("pruneDiskRecord", () => {
  const full = toDiskRecord(dummyRecord, { t: 1 });
  const bytes = serializeDiskRecord(full);
  const expectedSha = createHash("sha256").update(bytes).digest("hex");

  const pruned = pruneDiskRecord(full);
  assert.equal(pruned.trajectory.transcript, undefined);
  assert.equal(pruned.agent_transcript, undefined);
  assert.equal(pruned.full_record_sha256, expectedSha);
  
  // ensure original isn't mutated
  assert.equal(full.trajectory.transcript, "hello");
  assert.deepEqual(full.agent_transcript, { t: 1 });
});
