// lint.test.mjs — tests for rules-lint (#76)
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lintContent, lintRules, resolveTargets } from "../lint.mjs";

const CLI_PATH = fileURLToPath(new URL("../lint.mjs", import.meta.url));

test("all-labelled fixture returns [] from lintContent", () => {
  const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: TestAlert
        expr: up == 0
        labels:
          severity: critical
          service: test-service
`;
  const stats = { totalAlerts: 0 };
  const result = lintContent(yaml, "test.yml", stats);
  assert.deepEqual(result, []);
  assert.equal(stats.totalAlerts, 1);
});

test("missing-label fixture returns failure object", () => {
  const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: MissingService
        expr: up == 0
        labels:
          severity: warning
`;
  const stats = { totalAlerts: 0 };
  const result = lintContent(yaml, "bad.yml", stats);
  assert.equal(result.length, 1);
  assert.equal(result[0].alert, "MissingService");
  assert.equal(result[0].line, 5);
  assert.equal(result[0].file, "bad.yml");
  assert.equal(stats.totalAlerts, 1);
});

test("empty-value fixture treated as missing", () => {
  const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: EmptyService
        expr: up == 0
        labels:
          severity: warning
          service:
`;
  const stats = { totalAlerts: 0 };
  const result = lintContent(yaml, "empty.yml", stats);
  assert.equal(result.length, 1);
  assert.equal(result[0].alert, "EmptyService");
  assert.equal(result[0].line, 5);
  assert.equal(stats.totalAlerts, 1);
});

test("real live rule files all pass", () => {
  const files = resolveTargets([
    "use-cases/booklogr/stacks/flask-compose/observability/rules/*.yml",
  ]);
  assert.equal(files.length, 2);
  const stats = { totalAlerts: 0 };
  const failures = lintRules(files, stats);
  assert.deepEqual(failures, []);
  assert.equal(stats.totalAlerts, 5);
});

test("CLI exit 0 on all-labelled fixture", () => {
  const tmpDir = join(tmpdir(), `rules-lint-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const file = join(tmpDir, "good.yml");
  writeFileSync(
    file,
    `groups:\n  - name: g.rules\n    rules:\n      - alert: Good\n        expr: up == 0\n        labels:\n          service: s1\n`
  );
  try {
    const stdout = execFileSync("node", [CLI_PATH, file], { encoding: "utf8" });
    assert.match(stdout, /rules-lint: OK — 1 alert\(s\) across 1 file\(s\), all carry a service label/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI exit 1 on missing-label fixture", () => {
  const tmpDir = join(tmpdir(), `rules-lint-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const file = join(tmpDir, "bad.yml");
  writeFileSync(
    file,
    `groups:\n  - name: b.rules\n    rules:\n      - alert: Bad\n        expr: up == 0\n        labels:\n          severity: warning\n`
  );
  try {
    assert.throws(
      () => execFileSync("node", [CLI_PATH, file], { encoding: "utf8" }),
      (err) => {
        assert.equal(err.status, 1);
        assert.match(err.stderr, /rules-lint: FAIL — .*bad\.yml:4 alert "Bad" has no service label/);
        assert.match(err.stderr, /rules-lint: FAIL — 1 of 1 alert\(s\) missing a service label/);
        return true;
      }
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
