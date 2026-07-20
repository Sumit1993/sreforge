#!/usr/bin/env node
// =============================================================================
// webhook-wait.mjs — block until Alertmanager POSTs the firing notification to
// the on-call box, then print the payload JSON to stdout (ADR-0025).
//
// The listener runs INSIDE the sealed box (busybox `nc -l … -e`) — the box
// genuinely receives the push on the `oncall:8080` alias through the one
// inbound firewall pinhole. This host-side wrapper only execs the listener (as
// the non-root agent uid, like every other in-box action) and reads back the
// captured body.
//
// WHY `-e` + A HANDLER, NOT `printf 200 | nc -l`
//   Piping a canned response into nc answers BEFORE reading the request, and
//   busybox nc exits on stdin-EOF — against a real HTTP client (Alertmanager's
//   Go transport writes headers and body separately) the connection closes
//   before the body arrives and the capture is empty. The handler instead
//   reads the request FIRST (Content-Length-aware), saves the body, and only
//   then answers — 200 on a captured body, 500 otherwise so Alertmanager
//   RETRIES instead of recording a delivery that was lost.
//
// stdout: the notification payload as one JSON document (machine-consumable —
//         auto-incident.mjs feeds it to the agent driver).
// stderr: human progress lines.
// exit:   0 payload received · 2 timeout · 1 anything else
//
// Env: WEBHOOK_TIMEOUT_S (default 420 — covers arm's storm ramp + rule `for`,
//      and the repeat_interval re-page on same-session repeat runs),
//      WEBHOOK_PORT (default 8080), AGENT_UID/GID (default current).
// =============================================================================
import { execFileSync } from "node:child_process";
import { mergeNotifications, parseCaptureFile } from "./lib-storm.mjs";

const env = process.env;
const CONTAINER = "agent-shell";
const PORT = Number(env.WEBHOOK_PORT || 8080);
const TIMEOUT_S = Number(env.WEBHOOK_TIMEOUT_S || 420);
const STORM_WINDOW_S = Number(env.WEBHOOK_STORM_WINDOW_S || 0);
const U = `${env.AGENT_UID || process.getuid()}:${env.AGENT_GID || process.getgid()}`;
const OUT = "/tmp/.oncall-notification.json"; // in-box; box is recreated per run

try {
  execFileSync("docker", ["inspect", CONTAINER], { stdio: "ignore" });
} catch {
  console.error(`webhook-wait: FATAL: ${CONTAINER} not running — bring the sandbox up first.`);
  process.exit(1);
}

// Per-connection handler (nc -e): stdin/stdout ARE the accepted socket.
// Plain POSIX sh on busybox: read headers, pull Content-Length, read exactly
// that many body bytes, answer by capture outcome.
const HANDLER = `#!/bin/sh
CR=$(printf '\\r')
CL=0
while read -r line; do
  line="\${line%\$CR}"
  case "$line" in
    [Cc]ontent-[Ll]ength:*) CL=$(printf '%s' "\${line#*:}" | tr -d ' \\t') ;;
    "") break ;;
  esac
done
case "$CL" in ''|*[!0-9]*) CL=0 ;; esac
if [ "$CL" -gt 0 ]; then
  head -c "$CL" > ${OUT}.tmp
  if [ -s ${OUT}.tmp ]; then
    cat ${OUT}.tmp >> ${OUT}
    printf '\\036' >> ${OUT}
  fi
fi
if [ -s ${OUT}.tmp ]; then
  printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n'
else
  printf 'HTTP/1.1 500 Internal Server Error\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n'
fi
`;

// Ship the handler in over exec stdin (no shell-quoting hazards), then run the
// listener: one nc per connection, re-listen until a body lands or `timeout`
// (bounds the whole wait) kills the loop — a never-firing alert cannot hang
// the automation forever.
const HSH = "/tmp/.oncall-handler.sh";
execFileSync("docker", ["exec", "-i", "-u", U, CONTAINER, "sh", "-c", `cat > ${HSH}`], {
  input: HANDLER,
});
const LISTEN =
  `rm -f ${OUT} ${OUT}.tmp; timeout ${TIMEOUT_S} sh -c ` +
  `'while [ ! -s ${OUT} ]; do nc -l -p ${PORT} -e sh ${HSH} || exit 3; done'; ` +
  `rc=$?; ` +
  `if [ -s ${OUT} ] && [ ${STORM_WINDOW_S} -gt 0 ]; then ` +
  `  timeout ${STORM_WINDOW_S} sh -c 'while true; do nc -l -p ${PORT} -e sh ${HSH}; done'; ` +
  `fi; ` +
  `rm -f ${HSH} ${OUT}.tmp; [ -s ${OUT} ] && cat ${OUT} || exit $rc`;

console.error(`webhook-wait: listening in-box on :${PORT} (timeout ${TIMEOUT_S}s)…`);
let body;
try {
  body = execFileSync("docker", ["exec", "-u", U, CONTAINER, "sh", "-c", LISTEN], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (e) {
  // busybox `timeout` kills the loop with SIGTERM → exit 143 (124 on coreutils).
  const status = e.status ?? 1;
  if (status === 143 || status === 124) {
    console.error(`webhook-wait: TIMEOUT — no notification within ${TIMEOUT_S}s.`);
    process.exit(2);
  }
  console.error(`webhook-wait: listener failed (exit ${status}): ${(e.stderr || e.message || "").toString().slice(0, 400)}`);
  process.exit(1);
}

let payloads;
try {
  payloads = parseCaptureFile(body);
} catch (e) {
  console.error(`webhook-wait: captured a request body but it failed to parse: ${e.message}\n${body.slice(0, 800)}`);
  process.exit(1);
}

if (payloads.length === 0) {
  console.error(`webhook-wait: captured empty payloads`);
  process.exit(1);
}

const merged = STORM_WINDOW_S > 0 ? mergeNotifications(payloads) : payloads[0];

const alerts = Array.isArray(merged.alerts) ? merged.alerts.length : 0;
const names = [...new Set((merged.alerts || []).map((a) => a?.labels?.alertname).filter(Boolean))];
console.error(`webhook-wait: 🔔 notification received — ${alerts} alert(s)${names.length ? ` [${names.join(", ")}]` : ""}`);
process.stdout.write(JSON.stringify(merged));
