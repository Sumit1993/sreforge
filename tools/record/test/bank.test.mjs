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

function initFakeStore(repoUrl = "https://github.com/prismalens/sreforge-runs.git") {
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
    confinement: "host-sandboxed",
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
    confinement: "host-sandboxed",
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
  const storeDir = initFakeStore("https://github.com/prismalens/sreforge.git");
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  assert.throws(
    () => {
      execFileSync("node", [SCRIPT, recPath, "--store", storeDir, "--dry-run"], { encoding: "utf8" });
    },
    (err) => {
      assert.ok(err.stderr.includes("FATAL: --store points at 'https://github.com/prismalens/sreforge.git', not sreforge-runs. Refusing to bank records into a non-private store."));
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
  const sshStoreDir = initFakeStore("git@github.com:prismalens/sreforge-runs.git");
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, "full_record.json");
  writeFileSync(recPath, JSON.stringify(fixtureFullRecord, null, 2));

  const sshOut = execFileSync("node", [SCRIPT, recPath, "--store", sshStoreDir, "--dry-run"], { encoding: "utf8" });
  assert.match(sshOut, /Would bank records\/[a-f0-9]{64}\.json/);

  const spoofedStoreDir = initFakeStore("https://evil.com/github.com/prismalens/sreforge-runs.git");
  assert.throws(
    () => {
      execFileSync("node", [SCRIPT, recPath, "--store", spoofedStoreDir, "--dry-run"], { encoding: "utf8" });
    },
    (err) => {
      assert.ok(err.stderr.includes("FATAL: --store points at 'https://evil.com/github.com/prismalens/sreforge-runs.git', not sreforge-runs. Refusing to bank records into a non-private store."));
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

// ---------------------------------------------------------------------------
// #124 — the confinement label gate. A record whose driver dropped its handoff
// cannot say how it was measured; banking its verdict anyway is what these
// tests forbid. See the block comment above unlabelledReason() in bank.mjs.
// ---------------------------------------------------------------------------

function writeRecord(record, name = "rec.json") {
  const workDir = createTempDir("sreforge-test-rec-");
  const recPath = join(workDir, name);
  writeFileSync(recPath, JSON.stringify(record, null, 2));
  return recPath;
}

/**
 * Writes a record into its own git repo and stages it, so bank.mjs's
 * `git ls-files` sees it as TRACKED — a record this repo has already accepted,
 * which the inversion guard grandfathers.
 */
function writeTrackedRecord(record, name = "rec.json") {
  const workDir = createTempDir("sreforge-test-tracked-");
  execFileSync("git", ["init"], { cwd: workDir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: workDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workDir });
  const recPath = join(workDir, name);
  writeFileSync(recPath, JSON.stringify(record, null, 2));
  execFileSync("git", ["add", "--", name], { cwd: workDir });
  return recPath;
}

function runBank(args) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
}

test("9. unlabelled refusal — a full record with no agent_transcript is refused, not banked", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixtureFullRecord;
  const recPath = writeRecord({ ...noHeader, run_id: "run-test-no-header" }, "no_header.json");

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1, "an unlabelled record must make the run exit non-zero");
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[refused\].*unlabelled record — no agent_transcript header at all/);
  assert.doesNotMatch(combined, /Would bank records\//);
  assert.match(combined, /Refused 1 unlabelled record\(s\)/);

  const idx = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx.length, 0, "a refused record must not enter index.json");
});

test("10. unlabelled refusal — a header without confinement is refused", () => {
  const storeDir = initFakeStore();
  const { confinement, ...headerNoConfinement } = fixtureFullRecord.agent_transcript;
  const recPath = writeRecord(
    { ...fixtureFullRecord, run_id: "run-test-no-conf", agent_transcript: headerNoConfinement },
    "no_confinement.json"
  );

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /\[refused\].*agent_transcript\.confinement is missing/);
});

test("11. unlabelled refusal — an out-of-enum confinement value is refused", () => {
  const storeDir = initFakeStore();
  const recPath = writeRecord(
    {
      ...fixtureFullRecord,
      run_id: "run-test-bad-conf",
      agent_transcript: { ...fixtureFullRecord.agent_transcript, confinement: "host-sandbox" },
    },
    "bad_confinement.json"
  );

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1);
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[refused\].*confinement is not a recognised tier/);
  assert.match(combined, /host-open \| host-sandboxed \| in-box/);
});

test("12. inversion case (untracked) — a NEW verdict-bearing record with no agent_transcript key is refused, not skipped as pruned", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixturePrunedRecord;
  const recPath = writeRecord({ ...noHeader, run_id: "run-test-inversion" }, "inversion.json");

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1, "a dropped handoff must not launder a verdict into the public-eligible arm");
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[refused\].*no agent_transcript header at all/);
  assert.doesNotMatch(combined, /\[skip\].*skipped: pruned/);
});

test("12b. inversion case (tracked) — the same record, already tracked by git, keeps skipping as pruned", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixturePrunedRecord;
  const recPath = writeTrackedRecord({ ...noHeader, run_id: "run-test-inversion-tracked" }, "inversion.json");

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 0, "records this repo has already accepted must not make runs:import permanently red");
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[skip\].*skipped: pruned/);
  assert.doesNotMatch(combined, /\[refused\]/);
});

test("12c. tracked scoping is inversion-arm only — a tracked FULL record with no agent_transcript is still refused", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixtureFullRecord;
  const recPath = writeTrackedRecord({ ...noHeader, run_id: "run-test-tracked-full" }, "tracked_full.json");

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1, "the full arm grandfathers on store presence only, never on git tracking");
  assert.match(res.stdout + res.stderr, /\[refused\].*no agent_transcript header at all/);
});

test("13. pre-#123 pruned records keep skipping — an identity header without confinement is not refused on the pruned arm", () => {
  const storeDir = initFakeStore();
  const { confinement, ...headerNoConfinement } = fixturePrunedRecord.agent_transcript;
  const recPath = writeRecord(
    { ...fixturePrunedRecord, run_id: "run-test-legacy-pruned", agent_transcript: headerNoConfinement },
    "legacy_pruned.json"
  );

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 0, "the historical pruned corpus must stay importable");
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[skip\].*skipped: pruned/);
  assert.doesNotMatch(combined, /\[refused\]/);
});

test("14. --allow-unlabelled — banks with a loud warning instead of refusing", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixtureFullRecord;
  const recPath = writeRecord({ ...noHeader, run_id: "run-test-override" }, "override.json");

  const res = runBank([recPath, "--store", storeDir, "--no-push", "--allow-unlabelled"]);
  assert.equal(res.status, 0);
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[warn\].*unlabelled record — no agent_transcript header at all.*--allow-unlabelled/);
  assert.match(combined, /\[banked\] records\/[a-f0-9]{64}\.json/);
  assert.doesNotMatch(combined, /\[refused\]/);

  const idx = JSON.parse(readFileSync(join(storeDir, "index.json"), "utf8"));
  assert.equal(idx.length, 1);
});

test("15. grandfathering — an unlabelled record already in the store stays [already-present], never refused", () => {
  const storeDir = initFakeStore();
  const { agent_transcript, ...noHeader } = fixtureFullRecord;
  const recPath = writeRecord({ ...noHeader, run_id: "run-test-grandfathered" }, "grandfathered.json");

  // Get it into the store the way the historical corpus got there.
  const first = runBank([recPath, "--store", storeDir, "--no-push", "--allow-unlabelled"]);
  assert.equal(first.status, 0);

  // Re-banking it WITHOUT the override must be a no-op, not a wall of refusals.
  const second = runBank([recPath, "--store", storeDir, "--no-push"]);
  assert.equal(second.status, 0, "re-banking the historical corpus must not fail");
  const combined = second.stdout + second.stderr;
  assert.match(combined, /\[already-present\] records\/[a-f0-9]{64}\.json/);
  assert.doesNotMatch(combined, /\[refused\]/);
});

test("16. no-content-leak — a refusal reason never echoes the offending value or record body", () => {
  const storeDir = initFakeStore();
  const recPath = writeRecord(
    {
      ...fixtureFullRecord,
      run_id: "run-test-leak",
      agent_transcript: { ...fixtureFullRecord.agent_transcript, confinement: "SECRET_TRANSCRIPT_MARKER" },
    },
    "leaky_confinement.json"
  );

  const res = runBank([recPath, "--store", storeDir, "--dry-run"]);
  assert.equal(res.status, 1);
  const combined = res.stdout + res.stderr;
  assert.match(combined, /\[refused\]/);
  assert.equal(combined.includes("SECRET_TRANSCRIPT_MARKER"), false);
});

