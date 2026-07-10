#!/usr/bin/env node
// =============================================================================
// agent-loop.mjs — IN-BOX reasoning loop for the sealed agent-shell container.
//
// Adapted from the host-side agent-ollama.mjs; runs INSIDE the box as the `dev`
// user, cwd /workspace. Actions are LOCAL shell commands (no docker anywhere).
// The host driver (agent-inbox.sh) injects the API key PER-EXEC and tees stdout.
//
// Config is STRICTLY from env — no .env loading (the box has no .env):
//   OLLAMA_API_KEY   required (fail loud)
//   OLLAMA_MODEL     default qwen3-coder:480b-cloud
//   OLLAMA_HOST      default https://ollama.com
//   MAX_STEPS        default 30
//   WEBHOOK_PAYLOAD  optional (same kickoff semantics as agent-ollama.mjs)
//
// Exit 0 if submitted, 2 if the step budget ran out, 1 on a permanent
// provider failure — the transcript is written on every exit path.
// =============================================================================
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const env = process.env;

const OLLAMA_HOST = (env.OLLAMA_HOST || "https://ollama.com").replace(/\/+$/, "");
const MODEL = env.OLLAMA_MODEL || "qwen3-coder:480b-cloud";
const KEY = env.OLLAMA_API_KEY;
const MAX_STEPS = Number(env.MAX_STEPS || 30);
// Request-size knobs, env-tunable: some provider tiers 500 on large chat
// payloads (observed on Ollama Cloud ~steps 10-12 as the window fills), so a
// throttled tier can trade context for reliability per run.
const OUT_MAX = Number(env.AGENT_OUT_MAX || 3000); // cap per tool output fed back
const WINDOW = Number(env.AGENT_WINDOW || 22); // sliding window: system + kickoff + most-recent

if (!KEY) {
  console.error("FATAL: OLLAMA_API_KEY is required (injected by the host driver).");
  process.exit(1);
}

// ---- local shell execution (no docker — we ARE in the box) ------------------
function localShell(command) {
  try {
    const out = execFileSync("sh", ["-c", command], {
      encoding: "utf8",
      cwd: "/workspace",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number(env.AGENT_SHELL_TIMEOUT_MS || 120000),
    });
    return { exit: 0, out };
  } catch (e) {
    return { exit: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

const clip = (s) =>
  s.length > OUT_MAX ? `${s.slice(0, OUT_MAX)}\n…[truncated ${s.length - OUT_MAX} bytes]` : s;

// ---- tool schema (native Ollama /api/chat `tools`) --------------------------
const tools = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command on this host (from /workspace). Use it to investigate " +
        "via curl to the observability endpoints and the app, to read and edit the service code in " +
        "/workspace, and to run git. Returns combined stdout+stderr and the exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run." } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit",
      description:
        "Hand off your fix for grading. Commits your /workspace edits and signals completion. " +
        "Call this exactly once, when your fix is applied.",
      parameters: {
        type: "object",
        properties: { note: { type: "string", description: "One-line summary of the fix." } },
      },
    },
  },
];

// System prompt: the agent IS on the incident host (no "runs inside" indirection).
const SYSTEM = [
  "You are an on-call SRE engineer. An incident is affecting a service you operate.",
  "The alerting stack is the source of truth — start there and let the signals lead you.",
  "You act ONLY through the run_shell tool, which runs commands on this host.",
  "Reachable endpoints are in env vars — run `env | grep _URL` to see",
  "ALERTMANAGER_URL, PROM_URL, GRAFANA_URL and API_URL, then curl them to investigate.",
  "The service's source is a git checkout at /workspace — read it, find the regression that",
  "explains the signals, and fix it in place.",
  "Investigate efficiently: prefer targeted commands (grep -rn, reading specific files, git log)",
  "over dumping large directory trees; keep each command's output focused.",
  "When your fix is applied, call submit. Keep working until you have submitted.",
].join("\n");

// Kickoff: symptom-level only — never name the alert cause (de-tell).
const KICKOFF = env.WEBHOOK_PAYLOAD
  ? "This alert notification was just delivered:\n" +
    env.WEBHOOK_PAYLOAD +
    "\nInvestigate from the alerting stack, find the root cause in the code, " +
    "apply a fix in /workspace, and submit."
  : "An alert is firing for the service. Investigate from the alerting stack, find the root " +
    "cause in the code, apply a fix in /workspace, and submit.";

const messages = [
  { role: "system", content: SYSTEM },
  { role: "user", content: KICKOFF },
];

// Sliding context window: always keep [system, kickoff]; then the most-recent
// messages up to WINDOW. Never start the tail on an orphan tool result.
function trimmed() {
  if (messages.length <= WINDOW) return messages;
  const head = messages.slice(0, 2);
  let start = messages.length - (WINDOW - 2);
  while (start > 2 && messages[start]?.role === "tool") start--;
  return [...head, ...messages.slice(start)];
}

// Retry transient provider failures (5xx / 429 / network); 4xx is non-retryable.
async function chat() {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: trimmed(), tools, stream: false }),
        signal: AbortSignal.timeout(Number(env.CHAT_TIMEOUT_MS || 120000)),
      });
      if (res.ok) return res.json();
      const body = clip(await res.text());
      if (res.status >= 500 || res.status === 429) throw new Error(`Ollama ${res.status}: ${body} (transient)`);
      throw new Error(`Ollama ${res.status}: ${body}`);
    } catch (e) {
      lastErr = e;
      const retryable = /transient|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|network|socket|timeout|abort/i.test(e.message);
      if (attempt >= 5 || !retryable) throw lastErr;
      const wait = Math.min(3000 * attempt, 15000);
      console.error(`  (transient: ${e.message}; retry ${attempt}/4 in ${wait / 1000}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---- transcript (JSON to .sreforge/; the diff capture excludes .sreforge/) ---
// Written on every exit path — including a permanent chat() failure, where the
// history up to the failure is exactly what's needed to debug it.
const transcriptPath = "/workspace/.sreforge/agent-transcript.json";
function saveTranscript() {
  mkdirSync("/workspace/.sreforge", { recursive: true });
  writeFileSync(transcriptPath, JSON.stringify({ model: MODEL, submitted, messages }, null, 2));
}

// ---- the loop ---------------------------------------------------------------
console.log(`agent-loop: model=${MODEL} host=${OLLAMA_HOST} steps<=${MAX_STEPS}\n`);
let submitted = false;
for (let step = 1; step <= MAX_STEPS && !submitted; step++) {
  let data;
  try {
    data = await chat();
  } catch (e) {
    console.error(`step ${step}: ${e.message}`);
    saveTranscript();
    console.error(`agent-loop: transcript → ${transcriptPath}`);
    process.exit(1);
  }
  const msg = data.message || {};
  messages.push(msg);
  if (msg.content && msg.content.trim()) console.log(`[${step}] 🧠 ${msg.content.trim()}`);

  const calls = msg.tool_calls || [];
  if (calls.length === 0) {
    messages.push({ role: "user", content: "Continue: call run_shell to investigate/fix, or submit when done." });
    continue;
  }
  for (const c of calls) {
    const name = c.function?.name;
    let args = c.function?.arguments;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    args = args || {};
    if (name === "run_shell") {
      const cmd = String(args.command || "");
      console.log(`[${step}] $ ${cmd}`);
      const r = localShell(cmd);
      console.log(clip(r.out).trimEnd());
      messages.push({ role: "tool", tool_name: "run_shell", content: clip(`(exit ${r.exit})\n${r.out}`) });
    } else if (name === "submit") {
      const note = String(args.note || "fix").replace(/[^\w .,:;/-]/g, " ").slice(0, 200);
      console.log(`[${step}] ✅ submit: ${note}`);
      // submit is on PATH (/usr/local/bin/submit) — run it directly
      const r = localShell(`submit "${note}"`);
      console.log(r.out.trimEnd());
      messages.push({ role: "tool", tool_name: "submit", content: clip(`(exit ${r.exit})\n${r.out}`) });
      submitted = r.exit === 0;
    } else {
      messages.push({ role: "tool", tool_name: name || "unknown", content: `unknown tool: ${name}` });
    }
  }
}

saveTranscript();
console.log(`\nagent-loop: ${submitted ? "SUBMITTED ✅" : "did NOT submit ⚠"} — transcript → ${transcriptPath}`);
process.exit(submitted ? 0 : 2);
