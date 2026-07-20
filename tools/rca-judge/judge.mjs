#!/usr/bin/env node
// rca-judge — grade an agent-written RCA (whole text, SINGLE rubric) against the
// scenario's authored root-cause truth on 3 axes, producing a bounded,
// reproducible score + rationale banked to runs/<runId>/diagnosis.json.
//
// This is the DESCOPED #56 (issue comment, 2026-07-20): per-fact grading, alias
// classes, and required/forbidden fact lists are DEFERRED — this grades the whole
// RCA once. The judge emits ONLY booleans + a rationale; ALL arithmetic happens
// here in harness code (ADR-0027: no arithmetic in the judge). The diagnosis is
// REPORTED beside the verdict, never inside it — it does not gate anything.
//
// Non-Claude judge is an ADR-0027 §14 requirement: the model call is a plain
// Ollama /api/chat POST (same pattern as the booklogr agent-ollama driver). No
// Anthropic client is wired here.
//
// Three modes (mirrors detell-judge's prompt-first / --grade split):
//
//   --prepare   assemble the filled judge prompt → <out>/judge-input.md. No model
//               call, no API cost. Feed it to any model, save its JSON verdict.
//   --grade     parse an externally-produced verdict JSON + apply the deterministic
//               scoring. No model call. Writes/prints diagnosis.json.
//   --judge     end-to-end: assemble prompt, call the pinned model (RCA_JUDGE_MODEL),
//               parse (retry up to 3×), grade, write diagnosis.json. Best-effort:
//               judge unreachable / parse failure after retries → log loudly, write
//               nothing, exit 0 (an absent score is a normal state).
//
// Inputs (RCA text, in priority order):
//   --run-dir <runs/<runId>>   reads <dir>/rca.txt, falls back to rca.json raw_text
//   --rca-file <path>          reads the RCA text directly (no run dir) — this is the
//                              surface prismalens's ScoringOracle adapter calls.
// Ground truth:
//   --scenario <scenario-dir>  reads verify/oracle.md "## Root cause (harness-internal)"
//
// Output dir: --run-dir if given, else --out. diagnosis.json lands there.
//   --run-id / --scenario-id   override the derived ids (default: dir basenames)
//   --judge-model <id>         (--grade only) stamp for judge_model; else
//                              RCA_JUDGE_MODEL env, else "external".
//   --json                     print the diagnosis as JSON on stdout.
//
// Env: RCA_JUDGE_MODEL (required for --judge — no silent default), OLLAMA_HOST
//   (default https://ollama.com), OLLAMA_API_KEY (Ollama Cloud bearer, if set).

import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── constants (single source of truth; imported by tests) ────────────────────
export const RUBRIC_VERSION = "1";
export const SCHEMA_VERSION = "diagnosis.v1";
// Weighted sum in [0,1]. false_leads is scored inverted (no_false_leads): a true
// false_leads is BAD and forfeits its weight. The three weights sum to exactly 1.
export const WEIGHTS = { root_cause_correct: 0.5, evidence_grounded: 0.3, no_false_leads: 0.2 };
const ROOT_CAUSE_HEADING = "## Root cause (harness-internal)";

function fail(msg) {
  process.stderr.write(`rca-judge: ${msg}\n`);
  process.exit(2);
}
function loud(msg) {
  process.stderr.write(`rca-judge: ${msg}\n`);
}

// ── deterministic scoring — the ONLY arithmetic, all of it here ──────────────
// axes: { root_cause_correct, evidence_grounded, false_leads } (booleans).
export function computeScore(axes) {
  const rcc = axes.root_cause_correct ? 1 : 0;
  const eg = axes.evidence_grounded ? 1 : 0;
  const noFalse = axes.false_leads ? 0 : 1; // false_leads true = BAD
  const raw =
    WEIGHTS.root_cause_correct * rcc +
    WEIGHTS.evidence_grounded * eg +
    WEIGHTS.no_false_leads * noFalse;
  // Clamp to [0,1] and round away float noise (weights are decimal).
  return Math.min(1, Math.max(0, Math.round(raw * 1e6) / 1e6));
}

// ── ground-truth extraction ──────────────────────────────────────────────────
// Pull the "## Root cause (harness-internal)" section out of an oracle.md body:
// everything from that heading to the next top-level "## " heading.
export function extractRootCause(oracleMd) {
  const lines = oracleMd.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === ROOT_CAUSE_HEADING);
  if (start === -1) {
    throw new Error(
      `oracle.md has no "${ROOT_CAUSE_HEADING}" section — cannot judge without authored ground truth`,
    );
  }
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const text = body.join("\n").trim();
  if (!text) throw new Error(`"${ROOT_CAUSE_HEADING}" section is empty in oracle.md`);
  return text;
}

// ── prompt assembly (prepare) ─────────────────────────────────────────────────
export function assemblePrompt({ rcaText, rootCause }) {
  const rubric = readFileSync(join(HERE, "rubric.md"), "utf8");
  return rubric
    .split("{{ROOT_CAUSE}}").join(rootCause)
    .split("{{RCA}}").join(rcaText);
}

// ── verdict parsing (tolerant; fenced/bare/CLI-envelope) ─────────────────────
export function parseVerdict(text) {
  let s = String(text || "").trim();
  try {
    const env = JSON.parse(s);
    if (env && typeof env.result === "string") s = env.result.trim();
  } catch {}
  const candidates = [];
  const fj = s.match(/```json\s*([\s\S]*?)```/i); if (fj) candidates.push(fj[1]);
  const fa = s.match(/```\s*([\s\S]*?)```/); if (fa) candidates.push(fa[1]);
  const bare = s.match(/\{[\s\S]*\}/); if (bare) candidates.push(bare[0]);
  for (const c of candidates) {
    let v;
    try { v = JSON.parse(c.trim()); } catch { continue; }
    if (
      v && typeof v === "object" &&
      typeof v.root_cause_correct === "boolean" &&
      typeof v.evidence_grounded === "boolean" &&
      typeof v.false_leads === "boolean"
    ) {
      return {
        axes: {
          root_cause_correct: v.root_cause_correct,
          evidence_grounded: v.evidence_grounded,
          false_leads: v.false_leads,
        },
        rationale: typeof v.rationale === "string" ? v.rationale : "",
      };
    }
  }
  return null;
}

// ── the judge loop — model call injected so it is unit-testable ───────────────
// callModel(prompt) -> Promise<string> (raw model text). On malformed output,
// re-prompt up to `maxRetries` total attempts. Returns {axes, rationale} or null.
export async function runJudge({ prompt, callModel, maxRetries = 3 }) {
  let lastRaw = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let raw;
    try {
      raw = await callModel(
        attempt === 1
          ? prompt
          : `${prompt}\n\n--- Your previous reply could not be parsed as the required strict JSON: ---\n${lastRaw}\n\nReply with ONLY the single JSON object described above (the three booleans + rationale), nothing else.`,
      );
    } catch (err) {
      throw err; // transport errors bubble up; caller decides fatality
    }
    lastRaw = raw;
    const parsed = parseVerdict(raw);
    if (parsed) return parsed;
    loud(`judge output unparseable (attempt ${attempt}/${maxRetries})`);
  }
  return null;
}

// ── diagnosis record ──────────────────────────────────────────────────────────
export function buildDiagnosis({ runId, scenario, axes, rationale, judgeModel }) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    scenario,
    score: computeScore(axes),
    axes: {
      root_cause_correct: axes.root_cause_correct,
      evidence_grounded: axes.evidence_grounded,
      false_leads: axes.false_leads,
    },
    rationale: rationale || "",
    rubric_version: RUBRIC_VERSION,
    judge_model: judgeModel,
    judged_at: new Date().toISOString(),
  };
}

// ── real model call (Ollama /api/chat) — mirrors agent-ollama.mjs ─────────────
async function ollamaCall(prompt) {
  const model = process.env.RCA_JUDGE_MODEL;
  if (!model) {
    // Should be caught earlier; guard anyway so we never silently pick a default.
    throw new Error("RCA_JUDGE_MODEL is not set");
  }
  const host = (process.env.OLLAMA_HOST || "https://ollama.com").replace(/\/+$/, "");
  const key = process.env.OLLAMA_API_KEY;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data?.message?.content || "";
}

// ── input resolution ──────────────────────────────────────────────────────────
function readRca(opts) {
  if (opts.rcaFile) {
    if (!existsSync(opts.rcaFile)) fail(`--rca-file not found: ${opts.rcaFile}`);
    return readFileSync(opts.rcaFile, "utf8");
  }
  if (opts.runDir) {
    const txt = join(opts.runDir, "rca.txt");
    if (existsSync(txt)) return readFileSync(txt, "utf8");
    const jsonPath = join(opts.runDir, "rca.json");
    if (existsSync(jsonPath)) {
      let handoff;
      try { handoff = JSON.parse(readFileSync(jsonPath, "utf8")); }
      catch { fail(`rca.json in ${opts.runDir} is not valid JSON`); }
      if (typeof handoff.raw_text === "string") return handoff.raw_text;
      fail(`rca.json in ${opts.runDir} has no raw_text`);
    }
    fail(`no rca.txt or rca.json in run dir: ${opts.runDir}`);
  }
  fail("provide --run-dir <runs/<runId>> or --rca-file <path>");
}

function readRootCause(opts) {
  if (!opts.scenario) fail("--scenario <scenario-dir> is required");
  const oraclePath = join(opts.scenario, "verify", "oracle.md");
  if (!existsSync(oraclePath)) fail(`oracle not found: ${oraclePath}`);
  try {
    return extractRootCause(readFileSync(oraclePath, "utf8"));
  } catch (err) {
    fail(err.message);
  }
}

function outputDir(opts) {
  return opts.runDir || opts.out || null;
}
function derivedRunId(opts) {
  if (opts.runId) return opts.runId;
  if (opts.runDir) return basename(resolve(opts.runDir));
  if (opts.out) return basename(resolve(opts.out));
  return "unknown";
}
function derivedScenario(opts) {
  if (opts.scenarioId) return opts.scenarioId;
  if (opts.scenario) return basename(resolve(opts.scenario));
  return "unknown";
}

function writeDiagnosis(opts, diagnosis) {
  const dir = outputDir(opts);
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "diagnosis.json"), JSON.stringify(diagnosis, null, 2) + "\n", "utf8");
  }
  if (opts.json || !dir) process.stdout.write(JSON.stringify(diagnosis, null, 2) + "\n");
  return dir ? join(dir, "diagnosis.json") : null;
}

// ── arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    mode: null, runDir: null, rcaFile: null, scenario: null, out: null,
    runId: null, scenarioId: null, judgeModel: null, grade: null, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prepare") o.mode = "prepare";
    else if (a === "--judge") o.mode = "judge";
    else if (a === "--grade") { o.mode = "grade"; o.grade = argv[++i]; }
    else if (a === "--run-dir") o.runDir = argv[++i];
    else if (a === "--rca-file") o.rcaFile = argv[++i];
    else if (a === "--scenario") o.scenario = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--run-id") o.runId = argv[++i];
    else if (a === "--scenario-id") o.scenarioId = argv[++i];
    else if (a === "--judge-model") o.judgeModel = argv[++i];
    else if (a === "--json") o.json = true;
    else fail(`unknown flag: ${a}`);
  }
  if (!o.mode) fail("one of --prepare | --judge | --grade <verdict.json> is required");
  return o;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === "grade") {
    // Deterministic path — no model call. Parse a verdict, score it, emit diagnosis.
    if (!opts.grade) fail("--grade requires a verdict JSON path");
    if (!existsSync(opts.grade)) fail(`verdict file not found: ${opts.grade}`);
    const parsed = parseVerdict(readFileSync(opts.grade, "utf8"));
    if (!parsed) {
      fail(`could not parse a verdict (root_cause_correct/evidence_grounded/false_leads booleans) from ${opts.grade}`);
    }
    const diagnosis = buildDiagnosis({
      runId: derivedRunId(opts),
      scenario: derivedScenario(opts),
      axes: parsed.axes,
      rationale: parsed.rationale,
      judgeModel: opts.judgeModel || process.env.RCA_JUDGE_MODEL || "external",
    });
    const path = writeDiagnosis(opts, diagnosis);
    if (path) process.stderr.write(`rca-judge: wrote ${path} (score ${diagnosis.score})\n`);
    process.exit(0);
  }

  if (opts.mode === "prepare") {
    const rcaText = readRca(opts);
    const rootCause = readRootCause(opts);
    const prompt = assemblePrompt({ rcaText, rootCause });
    const dir = outputDir(opts);
    if (!dir) fail("--prepare needs --run-dir or --out to write judge-input.md");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "judge-input.md");
    writeFileSync(p, prompt, "utf8");
    process.stderr.write(
      `rca-judge: filled judge prompt written to ${p}\n` +
      `  Run it in any model (a DIFFERENT model than the one under test — independence),\n` +
      `  save the JSON verdict, then:  node tools/rca-judge/judge.mjs --grade <verdict.json> --out ${dir}\n`,
    );
    process.exit(0);
  }

  // --judge: end-to-end. Best-effort — never fatal on model/parse failure.
  const model = process.env.RCA_JUDGE_MODEL;
  if (!model) {
    fail("RCA_JUDGE_MODEL is not set — pin the judge model explicitly (no silent default). See README.");
  }
  const rcaText = readRca(opts);
  const rootCause = readRootCause(opts);
  const prompt = assemblePrompt({ rcaText, rootCause });

  let result = null;
  try {
    result = await runJudge({ prompt, callModel: ollamaCall });
  } catch (err) {
    loud(`judge model unreachable/failed: ${err.message} — writing no diagnosis (absent score is a normal state)`);
    process.exit(0);
  }
  if (!result) {
    loud("judge output unparseable after retries — writing no diagnosis (absent score is a normal state)");
    process.exit(0);
  }
  const diagnosis = buildDiagnosis({
    runId: derivedRunId(opts),
    scenario: derivedScenario(opts),
    axes: result.axes,
    rationale: result.rationale,
    judgeModel: model,
  });
  const path = writeDiagnosis(opts, diagnosis);
  if (path) process.stderr.write(`rca-judge: wrote ${path} (score ${diagnosis.score})\n`);
  process.exit(0);
}

// Only run main when invoked as a script — tests import the pure functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { loud(`unhandled: ${err.message}`); process.exit(2); });
}
