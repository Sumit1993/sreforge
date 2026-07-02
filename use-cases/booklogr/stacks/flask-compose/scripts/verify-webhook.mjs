#!/usr/bin/env node
// =============================================================================
// verify-webhook.mjs — ③ automated-trigger probes (ADR-0025). No model calls.
//
//   [route]    Alertmanager's live config routes to the neutral `oncall`
//              webhook receiver at http://oncall:8080/
//   [pinhole]  a deploy-plane peer can POST to oncall:8080 while an in-box
//              listener is up, and gets the listener's HTTP 200 back
//   [deny]     any OTHER inbound port on the box stays default-deny (times out)
//
// Needs the deploy plane + agent sandbox up (like verify:pickup). The pinhole
// probe POSTs from booklogr-api (python3 in the app image) — a genuine
// cross-container path through the box's firewall, not a host shortcut.
// =============================================================================
import { execFileSync, spawn } from "node:child_process";

const env = process.env;
const AM_STATUS = env.AM_STATUS_URL || "http://localhost:9093/api/v2/status";
const PORT = Number(env.WEBHOOK_PORT || 8080);
const U = `${env.AGENT_UID || process.getuid()}:${env.AGENT_GID || process.getgid()}`;
let failed = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); failed++; };

// ── [route] the live Alertmanager config names the oncall webhook ────────────
// The status API masks webhook URLs as `url: <secret>` (they often carry
// tokens), so the target URL is NOT checkable here — assert the route's
// default receiver is `oncall` and that it is a webhook receiver; the pinhole
// probe below proves the actual oncall:8080 path end-to-end.
try {
  const res = await fetch(AM_STATUS);
  const cfg = (await res.json())?.config?.original || "";
  if (/receiver:\s*oncall\b/.test(cfg) && /name:\s*oncall\b[\s\S]*?webhook_configs:/.test(cfg)) {
    pass("[route] Alertmanager's live route targets the oncall webhook receiver");
  } else {
    fail("[route] Alertmanager's live config has no oncall webhook receiver — restart it after editing alertmanager.yml?");
  }
} catch (e) {
  fail(`[route] Alertmanager status unreachable at ${AM_STATUS}: ${e.message}`);
}

// ── [pinhole] listener up in-box → POST from a plane peer → 200 + payload ────
// Two attempts: a live Alertmanager can deliver a real (re-)page into the
// one-shot listener at exactly the wrong moment (its capture then lacks our
// marker), and under a parallel `verify` aggregate the box is exec-contended.
// The bind is POLLED (not a fixed sleep) for the same reason.
const MARK = "verify-webhook-probe";
const PY_POST = [
  "import urllib.request,sys",
  `req = urllib.request.Request("http://oncall:${PORT}/", data=b'{"probe":"${MARK}"}', headers={"Content-Type":"application/json"})`,
  "print(urllib.request.urlopen(req, timeout=8).status)",
].join("\n");

async function pinholeAttempt() {
  const listen =
    `printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n'` +
    ` | timeout 20 nc -l -p ${PORT}`;
  const listener = spawn("docker", ["exec", "-u", U, "agent-shell", "sh", "-c", listen], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let captured = "";
  listener.stdout.on("data", (d) => (captured += d));
  const listenerDone = new Promise((r) => listener.on("close", r));
  let bound = false;
  for (let i = 0; i < 20 && !bound; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      execFileSync("docker", ["exec", "agent-shell", "sh", "-c", `netstat -tln 2>/dev/null | grep -q ':${PORT} '`], { timeout: 5000 });
      bound = true;
    } catch { /* not bound yet */ }
  }
  if (!bound) { listener.kill(); await listenerDone; return { status: "", captured: "" }; }
  let status = "";
  try {
    status = execFileSync("docker", ["exec", "booklogr-api", "python3", "-c", PY_POST], {
      encoding: "utf8", timeout: 15000,
    }).trim();
  } catch (e) {
    status = `error: ${(e.stderr || e.message || "").toString().slice(0, 200)}`;
  }
  await listenerDone;
  return { status, captured };
}

let pinhole = await pinholeAttempt();
if (!pinhole.captured.includes(MARK)) pinhole = await pinholeAttempt(); // retry once
if (pinhole.status === "200") pass("[pinhole] plane peer POST → oncall:" + PORT + " answered 200");
else fail(`[pinhole] POST to oncall:${PORT} did not get a 200 — is the INPUT pinhole in the running box? (${pinhole.status})`);
if (pinhole.captured.includes(MARK)) pass("[pinhole] in-box listener captured the posted payload");
else fail("[pinhole] listener saw no payload — POST did not traverse the pinhole");

// ── [deny] every other inbound port stays default-deny ───────────────────────
const PY_DENY = [
  "import socket,sys",
  "s = socket.socket(); s.settimeout(4)",
  "try:",
  `    s.connect(("oncall", ${PORT + 1})); print("CONNECTED")`,
  "except Exception as e:",
  "    print(type(e).__name__)",
].join("\n");
try {
  const out = execFileSync("docker", ["exec", "booklogr-api", "python3", "-c", PY_DENY], {
    encoding: "utf8", timeout: 15000,
  }).trim();
  if (out === "CONNECTED") fail(`[deny] port ${PORT + 1} accepted a connection — INPUT is broader than the pinhole`);
  else pass(`[deny] non-webhook inbound port ${PORT + 1} is dropped (${out})`);
} catch (e) {
  fail(`[deny] probe errored: ${(e.stderr || e.message || "").toString().slice(0, 200)}`);
}

console.log(failed ? `\nverify-webhook: ${failed} FAILURE(S)` : "\nverify-webhook: all probes passed");
process.exit(failed ? 1 : 0);
