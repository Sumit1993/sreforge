import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { classifyHijack, classifyRunnerError, classifyWincred, diffEnvKeys, summarize, runAllChecks, resolveRepoRoot } from "../lib.mjs";

test("classifyHijack", () => {
  assert.equal(classifyHijack({status: 200}, {status: 401}), "hijacked-proxy");
  assert.equal(classifyHijack({status: 200}, {status: 200, json: {version: "1.0"}}), "healthy");
  assert.equal(classifyHijack({status: 401}, {status: 401, json: {message: "Unauthorized"}}), "healthy");
  assert.equal(classifyHijack({status: 401}, {status: 401, headers: {'set-cookie': 'i_like_gitea'}}), "healthy");
  assert.equal(classifyHijack({status: 401}, {status: 401, json: {}, headers: {}}), "down");
  assert.equal(classifyHijack({status: null}, {status: null}), "down");
});

test("resolveRepoRoot", () => {
  const fakeUsecase = resolve("/fake/repo/use-cases/booklogr");
  assert.equal(resolveRepoRoot(fakeUsecase), resolve("/fake/repo"));
});

test("classifyRunnerError", () => {
  assert.equal(classifyRunnerError("OCI runtime create failed: ... docker-mounts ... not a directory"), "stale-shim");
  assert.equal(classifyRunnerError("some other error"), "other");
});

test("classifyWincred", () => {
  assert.equal(classifyWincred("error: docker-credential-wincred.exe ... exec format error"), "interop-broken");
  assert.equal(classifyWincred("some other error"), "other");
});

test("diffEnvKeys", () => {
  assert.deepEqual(diffEnvKeys("FOO=1\nBAR=2", "FOO=1"), ["BAR"]);
  assert.deepEqual(diffEnvKeys("FOO=1", "FOO=1\nBAZ=3"), []);
  assert.deepEqual(diffEnvKeys("FOO=1\nBAR=2", ""), ["FOO", "BAR"]);
});

test("summarize", () => {
  const allPass = [
    { plane: "core", id: "check1", status: "pass", detail: "ok" }
  ];
  assert.equal(summarize(allPass).exitCode, 0);
  assert.equal(summarize(allPass).lines[0], "PASS core/check1 — ok");

  const someWarn = [
    { plane: "core", id: "check1", status: "warn", detail: "hm" }
  ];
  assert.equal(summarize(someWarn).exitCode, 0);

  const someFail = [
    { plane: "core", id: "check1", status: "fail", detail: "bad" },
    { plane: "core", id: "check2", status: "pass", detail: "ok" }
  ];
  const { exitCode, lines } = summarize(someFail);
  assert.equal(exitCode, 1);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "FAIL core/check1 — bad");
});

test("runAllChecks", async () => {
  const checks = [
    { id: "c1", plane: "p", run: async () => ({ status: "pass", detail: "ok" }) },
    { id: "c2", plane: "p", run: async () => { throw new Error("boom"); } },
    { id: "c3", plane: "p", run: async () => ({ status: "pass", detail: "ok" }) },
  ];
  const res = await runAllChecks(checks);
  assert.equal(res.length, 3);
  assert.equal(res[1].status, "fail");
  assert.equal(res[1].detail, "boom");
});
