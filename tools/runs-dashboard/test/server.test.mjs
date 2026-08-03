// Server-level regression tests. These boot the real server.mjs as a child
// process and speak raw HTTP to it, because the bugs worth covering here are
// exactly the ones a fetch() client cannot express: a malformed request target
// that a well-behaved HTTP client would never send, and Host headers.
//
// No store is required — SREFORGE_RUNS_DIR points at a path that does not exist,
// which the server is expected to survive, so these run anywhere.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..", "server.mjs");
const NO_STORE = join(HERE, "does-not-exist-store");

let child;
let port;

/** Ask the OS for a free port, then release it for the server to claim. */
function freePort() {
  return new Promise((ok, fail) => {
    const probe = net.createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port: p } = probe.address();
      probe.close(() => ok(p));
    });
  });
}

/** Raw HTTP/1.1 request — lets us send targets a real client would refuse to. */
function rawRequest(target, host = `127.0.0.1:${port}`) {
  return new Promise((ok) => {
    let data = "";
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("data", (c) => (data += c));
    socket.on("close", () => ok(data));
    socket.on("error", () => ok(data));
  });
}

const statusOf = (raw) => Number(raw.split(/\s+/)[1] || 0); // "HTTP/1.1 200 OK" → 200

// Responses come back chunked (no content-length), so the raw body carries chunk
// sizes around the JSON. We only ever assert on one object, so slice it out.
const bodyOf = (raw) => JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), SREFORGE_RUNS_DIR: NO_STORE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`server did not boot; saw: ${out}`)), 10000);
    child.stdout.on("data", (c) => {
      out += c;
      if (out.includes("runs dashboard")) { clearTimeout(timer); ok(); }
    });
    child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`server exited early (${code})`)); });
  });
});

after(() => { child?.kill(); });

test("boots and serves with a missing store instead of crashing", async () => {
  assert.equal(statusOf(await rawRequest("/")), 200);
  const raw = await rawRequest("/api/summary");
  assert.equal(statusOf(raw), 200);
  const body = bodyOf(raw);
  assert.equal(body.ok, false);
  assert.match(body.error, /store not found/);
  assert.deepEqual(body.scenarios, []);
});

test("a malformed request target is refused, not fatal", async () => {
  // `//` is a protocol-relative reference: new URL("//", "http://127.0.0.1")
  // throws, and before this was guarded the TypeError killed the process.
  assert.equal(statusOf(await rawRequest("//")), 400);
  assert.equal(statusOf(await rawRequest("///")), 400);

  // The decisive assertion: the server is still answering afterwards.
  assert.equal(statusOf(await rawRequest("/api/summary")), 200);
  assert.equal(child.exitCode, null, "server process must still be running");
});

test("non-loopback Host is rejected (DNS-rebinding guard)", async () => {
  assert.equal(statusOf(await rawRequest("/api/summary", "evil.example")), 403);
  assert.equal(statusOf(await rawRequest("/", "attacker.test:1234")), 403);
  // …and the loopback authorities still pass.
  assert.equal(statusOf(await rawRequest("/api/summary", `localhost:${port}`)), 200);
  assert.equal(statusOf(await rawRequest("/api/summary", "127.0.0.1")), 200);
});

test("record ids that are not a sha256 never reach the filesystem", async () => {
  assert.equal(statusOf(await rawRequest("/api/run/zzz")), 400);
  assert.equal(statusOf(await rawRequest("/api/run/..%2f..%2findex.json")), 400);
  assert.equal(statusOf(await rawRequest("/api/runs")), 400); // missing ?scenario
  assert.equal(statusOf(await rawRequest("/nope")), 404);
  assert.equal(child.exitCode, null, "server process must still be running");
});
