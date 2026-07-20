import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBMIT_SCRIPT = resolve(HERE, "../../../infra/agent-sandbox/scripts/submit");

function tmp() {
  return mkdtempSync(join(tmpdir(), "sreforge-submit-"));
}

function runSubmit(workspace, args, env = {}) {
  const r = spawnSync("sh", [SUBMIT_SCRIPT, ...args], {
    cwd: workspace,
    env: { ...process.env, WORKSPACE: workspace, ...env },
    encoding: "utf8",
  });
  return { exit: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

test("submit --rca <file> copies rca exactly and writes valid sentinel", () => {
  const ws = tmp();
  execFileSync("git", ["init", ws]);
  execFileSync("git", ["-C", ws, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", ws, "config", "user.email", "test@test.com"]);
  execFileSync("git", ["-C", ws, "commit", "--allow-empty", "-m", "init"]);
  
  const rcaContent = 'multi-line\npostmortem with "quotes" and \\backslashes';
  const rcaPath = join(ws, "my-rca.txt");
  writeFileSync(rcaPath, rcaContent, "utf8");

  const r = runSubmit(ws, ["--rca", rcaPath, "fix note"]);
  assert.equal(r.exit, 0);

  const copiedRcaPath = join(ws, ".sreforge/rca.txt");
  assert.ok(existsSync(copiedRcaPath));
  assert.equal(readFileSync(copiedRcaPath, "utf8"), rcaContent);

  const sentinelPath = join(ws, ".sreforge/submit.json");
  assert.ok(existsSync(sentinelPath));
  const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  assert.equal(sentinel.note, "fix note");
});

test("submit without --rca works unchanged", () => {
  const ws = tmp();
  execFileSync("git", ["init", ws]);
  execFileSync("git", ["-C", ws, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", ws, "config", "user.email", "test@test.com"]);
  execFileSync("git", ["-C", ws, "commit", "--allow-empty", "-m", "init"]);

  const r = runSubmit(ws, ["fix note"]);
  assert.equal(r.exit, 0);

  assert.ok(!existsSync(join(ws, ".sreforge/rca.txt")));

  const sentinelPath = join(ws, ".sreforge/submit.json");
  assert.ok(existsSync(sentinelPath));
  const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  assert.equal(sentinel.note, "fix note");
});

test("submit --rca missing file prints warning but still submits", () => {
  const ws = tmp();
  execFileSync("git", ["init", ws]);
  execFileSync("git", ["-C", ws, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", ws, "config", "user.email", "test@test.com"]);
  execFileSync("git", ["-C", ws, "commit", "--allow-empty", "-m", "init"]);

  const missingPath = join(ws, "does-not-exist.txt");
  const r = runSubmit(ws, ["--rca", missingPath, "fix note"]);
  assert.equal(r.exit, 0);
  assert.match(r.out, /missing or empty/);

  assert.ok(!existsSync(join(ws, ".sreforge/rca.txt")));

  const sentinelPath = join(ws, ".sreforge/submit.json");
  assert.ok(existsSync(sentinelPath));
  const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  assert.equal(sentinel.note, "fix note");
});

test("submit --rca with no following path warns and proceeds without RCA", () => {
  const ws = tmp();
  execFileSync("git", ["init", ws]);
  execFileSync("git", ["-C", ws, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", ws, "config", "user.email", "test@test.com"]);
  execFileSync("git", ["-C", ws, "commit", "--allow-empty", "-m", "init"]);

  const r = runSubmit(ws, ["--rca"]);
  assert.equal(r.exit, 0);
  assert.match(r.out, /without a path, ignoring/);

  assert.ok(!existsSync(join(ws, ".sreforge/rca.txt")));

  const sentinelPath = join(ws, ".sreforge/submit.json");
  assert.ok(existsSync(sentinelPath));
  const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  assert.equal(sentinel.note, "");
});
