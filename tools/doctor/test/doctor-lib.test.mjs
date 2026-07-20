import { test } from "node:test";
import { strict as assert } from "node:assert";
import { classifyHijack, classifyRunnerError, classifyWincred, diffEnvKeys, summarize, runAllChecks } from "../lib.mjs";

test("classifyHijack", () => {
  assert.equal(classifyHijack(200, 401, true), "hijacked-proxy");
  assert.equal(classifyHijack(200, 200, true), "healthy");
  assert.equal(classifyHijack(401, 401, true), "healthy");
  assert.equal(classifyHijack(null, null, false), "down");
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
