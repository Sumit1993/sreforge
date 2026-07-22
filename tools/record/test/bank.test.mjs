import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "../bank.mjs");

function createTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initFakeStore(repoUrl = "https://github.com/Sumit1993/sreforge-runs.git") {
  const dir = createTempDir("sreforge-runs-store-");
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", repoUrl], { cwd: dir });
  mkdirSync(join(dir, "records"), { recursive: true });
  mkdirSync(join(dir, "evidence"), { recursive: true });
  writeFileSync(join(dir, "index.json"), "[]\n");
  writeFileSync(join(dir, "README.md"), "# Test Store\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir });
  return dir;
}

const fixtureFullRecord = {
  record_version: "1.0.0",
  kind: "run-record",
  run_id: "run-test-full-1",
  scenario_id: "booklogr/s1-test",
  profile: "incident",
  trigger: {
    source: "prom",
    alert_name: "TestAlert",
    labels: {},
    annotations: {},
    fired_at: "2026-07-22T00:00:00Z",
  },
  trajectory: {
    agent_name: "agent-test",
    transcript: "Line 1\nLine 2 SECRET_TRANSCRIPT_MARKER\nLine 3",
    diff: "--- a/file\n+++ b/file",
    submitted: true,
    duration_ms: 1000,
  },
  diff: "--- a/file\n+++ b/file",
  ci: null,
  deploy: null,
  score: {
    oracle_id: "main",
    score: 1.0,
    passed: true,
    signals: [],
  },
  verdict: "passed",
  timings: {},
  started_at: "2026-07-22T00:00:00Z",
  finished_at: "2026-07-22T00:01:00Z",
  agent_transcript: {
    schema_version: "1.0.0",
    run_id: "run-test-full-1",
    harness: "agy",
    session: "sess-123",
    raw_text: "RAW SECRET_TRANSCRIPT_MARKER DATA",
  },
};

const fixturePrunedRecord = {
  record_version: "1.0.0",
  kind: "run-record",
  run_id: "run-test-pruned-1",
  scenario_id: "booklogr/s1-test",
  profile: "incident",
  trigger: {
    source: "prom",
    alert_name: "TestAlert",
    labels: {},
    annotations: {},
    fired_at: "2026-07-22T00:00:00Z",
  },
  trajectory: {
    agent_name: "agent-test",
    diff: "--- a/file\n+++ b/file",
    submitted: true,
    duration_ms: 1000,
  },
  diff: "--- a/file\n+++ b/file",
  ci: null,
  deploy: null,
  score: {
    oracle_id: "main",
    score: 1.0,
    passed: true,
    signals: [],
  },
  verdict: "passed",
  timings: {},
  started_at: "2026-07-22T00:00:00Z",
  finished_at: "2026-07-22T00:01:00Z",
  agent_transcript: {
    schema_version: "1.0.0",
    run_id: "run-test-pruned-1",
    harness: "agy",
    session: "sess-123",
  },
  full_record_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
};

test("1. content-addressing — banking a fixture full record writes records/<sha>.json with filename == full_record_sha256", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  const out = execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--dry-run"], { encoding: "utf8" });
  assert.match(out, /Would bank records\/[a-f0-9]{64}\.json/);

  // Real run with --no-push
  const realOut = execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--no-push"], { encoding: "utf8" });
  assert.match(realOut, /\[banked\] records\/[a-f0-9]{64}\.json/);

  const idx = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx.length, 1);
  assert.equal(idx[0].run_id, "run-test-full-1");
  const sha = idx[0].sha256;
  assert.equal(idx[0].path, `records/${sha}.json`);
  assert.ok(existsSync(join(storeDir, `records/${sha}.json`)));
});

test("2. idempotency — banking the same record twice reports already-present and no duplicate index entry", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--no-push"], { encoding: "utf8" });
  const idx1 = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx1.length, 1);

  // Second run
  const out2 = execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--no-push"], { encoding: "utf8" });
  assert.match(out2, /\[already-present\]/);
  const idx2 = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx2.length, 1);
});


test("3. hash-mismatch guard — incorrect stored full_record_sha256 is recomputed with warning", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const badHashRecord = {
    ...fixtureFullRecord,
    full_record_sha256: "1111111111111111111111111111111111111111111111111111111111111111",
  };
  const recPath = join(workDir, "bad_hash.json");
  writeFileSync(recPath, JSON.stringify(badHashRecord, null, 2));

  const res = spawnSync("node", [SCRIPT, recPath, "--store", storeDir, "--no-push"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[warn\].*disagrees with recomputed/);
  assert.match(combined, /\[banked\] records\/[a-f0-9]{64}\.json/);
});

test("4. public-remote refusal — --store whose origin is sreforge.git exits non-zero with FATAL string", () => {
  const storeDir = initFakeStore("https://github.com/Sumit1993/sreforge.git");
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  assert.throws(
    () => {
      execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--dry-run"], { encoding: "utf8" });
    },
    (err) => {
      assert.ok(err.stderr.includes("FATAL: --store points at 'https://github.com/Sumit1993/sreforge.git', not sreforge-runs. Refusing to bank records into a non-private store."));
      return true;
    }
  );
});

test("5. no-content-leak — output contains no transcript/secret sentinel string", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  const out = execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--dry-run"], { encoding: "utf8" });
  assert.equal(out.includes("SECRET_TRANSCRIPT_MARKER"), false);
});

test("6. pruned skip — a pruned record (no transcript) is skipped", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "pruned_record.json");
  writeFileSync(recPath, JSON.stringify(fixturePrunedRecord, null, 2));

  const out = execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--dry-run"], { encoding: "utf8" });
  assert.match(out, /\[skip\].*skipped: pruned/);

  const idx = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx.length, 0);
});

test("7. anchored remote check — ssh remote passes, prefix-spoofed remote is rejected", () => {
  const sshStoreDir = initFakeStore("git@github.com:Sumit1993/sreforge-runs.git");
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  const sshOut = execFileSync("node", [SCRIPT, recPath, "--store", sshStoreDir, "--dry-run"], { encoding: "utf8" });
  assert.match(sshOut, /Would bank records\/[a-f0-9]{64}\.json/);

  const spoofedStoreDir = initFakeStore("https://evil.com/github.com/Sumit1993/sreforge-runs.git");
  assert.throws(
    () => {
      execFileSync("node", [SCRIPT, recPath, "--store", spoofedStoreDir, "--dry-run"], { encoding: "utf8" });
    },
    (err) => {
      assert.ok(err.stderr.includes("FATAL: --store points at 'https://evil.com/github.com/Sumit1993/sreforge-runs.git', not sreforge-runs. Refusing to bank records into a non-private store."));
      return true;
    }
  );
});

test("8. scoped git add — stray pre-existing content in store is not staged or committed", () => {
  const storeDir = initFakeStore();
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  // Create a stray untracked file in the store directory
  const strayFile = join(storeDir, "stray_untracked.txt");
  writeFileSync(strayFile, "untracked stray content");

  execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--no-push"], { encoding: "utf8" });

  // Verify the banking commit exists and does NOT include stray_untracked.txt
  const commitLog = execFileSync("git", ["-C", storeDir, "log", "-1", "--name-only"], { encoding: "utf8" });
  assert.ok(commitLog.includes("chore(record): bank full records and evidence"));
  assert.ok(!commitLog.includes("stray_untracked.txt"));

  // Verify stray file remains untracked in git status
  const status = execFileSync("git", ["-C", storeDir, "status", "--porcelain"], { encoding: "utf8" });
  assert.ok(status.includes("?? stray_untracked.txt"));
});

