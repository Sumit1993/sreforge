import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DECOY_RATE_LABEL, PASS_RATE_LABEL, RUN_KINDS,
  decoySignal, isPassed, median, runKind, runRows, summarizeScenarios,
} from "../lib.mjs";

// Hand-built records — only the fields the aggregation reads.
function rec({ run_id = "run-1", scenario_id = "latency-cache-stampede", verdict = "passed",
               score = 0.5, signals = [], started_at = "2026-07-01T00:00:00.000Z",
               finished_at = null, model = "Gemini 3.6 Flash (High)", sha256 = "a".repeat(64) } = {}) {
  return {
    run_id, scenario_id, verdict, started_at, finished_at, sha256, profile: "incident",
    score: { oracle_id: "mitigation", passed: verdict === "passed", score, signals },
    agent_transcript: model ? { harness: "external", model, confinement: "host-sandboxed" } : undefined,
  };
}

test("runKind maps run_id prefixes, longest match first", () => {
  assert.equal(runKind("campaign-latency-3"), "campaign");
  assert.equal(runKind("smoke-pos-1"), "smoke-pos");
  assert.equal(runKind("smoke-neg-1"), "smoke-neg");
  assert.equal(runKind("poscontrol-stampede-1"), "poscontrol");
  assert.equal(runKind("run-1785172979813"), "run");
  assert.equal(runKind("requalify-decoy-2"), "other");
  assert.equal(runKind(undefined), "other");
  // every kind produced is a declared kind
  for (const id of ["campaign-x", "smoke-pos-x", "smoke-neg-x", "poscontrol-x", "run-x", "zzz"]) {
    assert.ok(RUN_KINDS.includes(runKind(id)), id);
  }
});

test("median handles odd, even, empty and non-numeric input", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([0.9958295]), 0.9958295);
  assert.equal(median([]), null);
  assert.equal(median(undefined), null);
  assert.equal(median([1, null, "x", 3]), 2); // non-numeric dropped, not coerced to 0
});

test("isPassed counts only the passed verdict", () => {
  assert.equal(isPassed({ verdict: "passed" }), true);
  assert.equal(isPassed({ verdict: "failed" }), false);
  assert.equal(isPassed({ verdict: "rejected" }), false);
});

test("summarizeScenarios computes counts, pass rate, median and latest run", () => {
  const rows = summarizeScenarios([
    rec({ run_id: "campaign-lat-1", verdict: "passed", score: 1.0, started_at: "2026-07-01T00:00:00.000Z" }),
    rec({ run_id: "campaign-lat-2", verdict: "failed", score: 0.2, started_at: "2026-07-03T00:00:00.000Z" }),
    rec({ run_id: "run-3", verdict: "passed", score: 0.6, started_at: "2026-07-02T00:00:00.000Z" }),
    rec({ run_id: "smoke-neg-1", verdict: "rejected", score: 0.0, started_at: "2026-06-30T00:00:00.000Z" }),
  ]);
  assert.equal(rows.length, 1);
  const s = rows[0];
  assert.equal(s.runs, 4);
  assert.equal(s.passed, 2);
  assert.equal(s.pass_rate, 0.5);
  assert.equal(s.score_median, 0.4);                       // median of 0, 0.2, 0.6, 1.0
  assert.equal(s.latest_started_at, "2026-07-03T00:00:00.000Z");
  assert.deepEqual(s.kinds, { campaign: 2, "smoke-pos": 0, "smoke-neg": 1, poscontrol: 0, run: 1, other: 0 });
  assert.deepEqual(s.models, ["Gemini 3.6 Flash (High)"]);
});

test("summarizeScenarios splits scenarios and sorts most-recent first", () => {
  const rows = summarizeScenarios([
    rec({ scenario_id: "worker-cpu-starvation", started_at: "2026-06-01T00:00:00.000Z" }),
    rec({ scenario_id: "latency-cache-stampede", started_at: "2026-07-20T00:00:00.000Z" }),
  ]);
  assert.deepEqual(rows.map((r) => r.scenario_id), ["latency-cache-stampede", "worker-cpu-starvation"]);
});

test("distinct models are deduped, sorted, and tolerate a missing transcript", () => {
  const rows = summarizeScenarios([
    rec({ model: "Gemini 3.1 Pro (High)" }),
    rec({ model: "Gemini 3.6 Flash (High)" }),
    rec({ model: "Gemini 3.1 Pro (High)" }),
    rec({ model: null }),
  ]);
  assert.deepEqual(rows[0].models, ["Gemini 3.1 Pro (High)", "Gemini 3.6 Flash (High)"]);
  assert.equal(rows[0].runs, 4);
});

test("decoy scenario without an explicit decoy signal falls back to the pass/fail split", () => {
  // The live store's decoy records carry only the generic mitigation signals.
  const generic = [
    { id: "ci_green", satisfied: true }, { id: "alert_cleared", satisfied: false },
    { id: "no_new_alerts", satisfied: true },
  ];
  const [s] = summarizeScenarios([
    rec({ scenario_id: "decoy-deploy-control", verdict: "failed", signals: generic }),
    rec({ scenario_id: "decoy-deploy-control", verdict: "failed", signals: generic }),
    rec({ scenario_id: "decoy-deploy-control", verdict: "passed", signals: generic }),
  ]);
  assert.equal(s.decoy, true);
  assert.equal(s.rate_label, PASS_RATE_LABEL);
  assert.equal(s.rate_label, "pass rate");   // the exact label the spec requires
  assert.equal(s.rate, 1 / 3);
  assert.equal(s.rate, s.pass_rate);
});

test("decoy scenario WITH an explicit falls_for_decoy signal reports a decoy rate", () => {
  const [s] = summarizeScenarios([
    rec({ scenario_id: "decoy-deploy-control", verdict: "failed", signals: [{ id: "falls_for_decoy", satisfied: true }] }),
    rec({ scenario_id: "decoy-deploy-control", verdict: "passed", signals: [{ id: "falls_for_decoy", satisfied: false }] }),
    rec({ scenario_id: "decoy-deploy-control", verdict: "passed", signals: [{ id: "falls_for_decoy", satisfied: false }] }),
    rec({ scenario_id: "decoy-deploy-control", verdict: "passed", signals: [{ id: "falls_for_decoy", satisfied: false }] }),
  ]);
  assert.equal(s.rate_label, DECOY_RATE_LABEL);
  assert.equal(s.rate, 0.25);        // decoy rate, NOT the 0.75 pass rate
  assert.equal(s.pass_rate, 0.75);   // pass rate still reported alongside
});

test("a non-decoy scenario never shows a decoy rate", () => {
  const [s] = summarizeScenarios([
    rec({ scenario_id: "latency-cache-stampede", signals: [{ id: "falls_for_decoy", satisfied: true }] }),
  ]);
  assert.equal(s.decoy, false);
  assert.equal(s.rate_label, PASS_RATE_LABEL);
});

test("decoySignal finds only the explicit ids", () => {
  assert.equal(decoySignal(rec({ signals: [{ id: "ci_green", satisfied: true }] })), null);
  assert.equal(decoySignal({}), null);
  assert.equal(decoySignal(rec({ signals: [{ id: "fell_for_decoy", satisfied: true }] })).id, "fell_for_decoy");
});

test("runRows filters by scenario, sorts newest first and derives duration", () => {
  const records = [
    rec({ scenario_id: "a", run_id: "run-old", started_at: "2026-07-01T00:00:00.000Z",
          finished_at: "2026-07-01T00:02:00.000Z", sha256: "b".repeat(64) }),
    rec({ scenario_id: "a", run_id: "campaign-new", started_at: "2026-07-09T00:00:00.000Z", finished_at: null }),
    rec({ scenario_id: "b", run_id: "run-other" }),
  ];
  const rows = runRows(records, "a");
  assert.deepEqual(rows.map((r) => r.run_id), ["campaign-new", "run-old"]);
  assert.deepEqual(rows.map((r) => r.kind), ["campaign", "run"]);
  assert.equal(rows[1].duration_ms, 120000);
  assert.equal(rows[0].duration_ms, null);         // no finished_at → no duration, not 0
  assert.equal(rows[1].sha256, "b".repeat(64));
  assert.equal(rows[1].model, "Gemini 3.6 Flash (High)");
  assert.equal(rows[1].oracle_id, "mitigation");
  assert.deepEqual(runRows(records, "nope"), []);
});

test("runRows reports a missing score as null, never as a coerced 0", () => {
  const base = { scenario_id: "a", run_id: "run-1", started_at: "2026-07-01T00:00:00.000Z" };
  const rows = runRows([
    { ...base, run_id: "r-null", score: { oracle_id: "mitigation", score: null } },
    { ...base, run_id: "r-missing", score: { oracle_id: "mitigation" } },
    { ...base, run_id: "r-string", score: { oracle_id: "mitigation", score: "0.9" } },
    { ...base, run_id: "r-noscore" },
    { ...base, run_id: "r-real", score: { oracle_id: "mitigation", score: 0.35 } },
    { ...base, run_id: "r-zero", score: { oracle_id: "mitigation", score: 0 } },
  ], "a");
  const by = Object.fromEntries(rows.map((r) => [r.run_id, r.score]));
  assert.equal(by["r-null"], null);      // Number(null) === 0 would have said 0
  assert.equal(by["r-missing"], null);
  assert.equal(by["r-string"], null);    // no coercion of numeric strings either
  assert.equal(by["r-noscore"], null);
  assert.equal(by["r-real"], 0.35);
  assert.equal(by["r-zero"], 0);         // a genuine 0 still survives the guard
});

test("ordering follows the instant, not the text, across timestamp formats", () => {
  // Three instants written three legal ways. Text order disagrees with
  // chronological order in both directions here:
  //   "+05:30" sorts by its local wall-clock digits, not by its instant
  //   "…:00Z" vs "…:00.500Z" — "." < "Z", so the LATER instant sorts first
  const rows = runRows([
    { scenario_id: "a", run_id: "second-oldest", started_at: "2026-07-01T12:00:00.500Z" },
    { scenario_id: "a", run_id: "newest", started_at: "2026-07-01T18:00:00+05:30" },  // 12:30Z
    { scenario_id: "a", run_id: "oldest", started_at: "2026-07-01T12:00:00Z" },
  ], "a");
  assert.deepEqual(rows.map((r) => r.run_id), ["newest", "second-oldest", "oldest"]);
});

test("scenario ordering compares instants and preserves the original string", () => {
  const rows = summarizeScenarios([
    // 09:00Z written as a +05:30 offset — textually "14:…", which a text compare
    // would rank above the 13:00Z below, though it is chronologically earlier.
    rec({ scenario_id: "older", started_at: "2026-07-01T14:30:00+05:30" }),
    rec({ scenario_id: "newer", started_at: "2026-07-01T13:00:00Z" }),
  ]);
  assert.deepEqual(rows.map((r) => r.scenario_id), ["newer", "older"]);
  // The reported value stays the record's own text, not a normalised rewrite.
  assert.equal(rows[1].latest_started_at, "2026-07-01T14:30:00+05:30");
});

test("latest_started_at picks the latest instant among mixed formats", () => {
  const [s] = summarizeScenarios([
    rec({ started_at: "2026-07-01T12:00:00Z" }),
    rec({ started_at: "2026-07-01T18:00:00+05:30" }),   // 12:30Z — the latest
    rec({ started_at: "2026-07-01T12:00:00.500Z" }),
  ]);
  assert.equal(s.latest_started_at, "2026-07-01T18:00:00+05:30");
});

test("unparseable and missing timestamps sink instead of winning", () => {
  const rows = summarizeScenarios([
    rec({ scenario_id: "junk", started_at: "not-a-date" }),
    rec({ scenario_id: "none", started_at: null }),
    rec({ scenario_id: "real", started_at: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.equal(rows[0].scenario_id, "real");
  assert.equal(rows[0].latest_started_at, "2026-01-01T00:00:00.000Z");
  // A garbage timestamp must not be reported as though it were a real one.
  assert.equal(rows.find((r) => r.scenario_id === "junk").latest_started_at, null);
  assert.equal(rows.find((r) => r.scenario_id === "none").latest_started_at, null);
});

test("empty and malformed input never throws", () => {
  assert.deepEqual(summarizeScenarios([]), []);
  assert.deepEqual(summarizeScenarios(undefined), []);
  const [s] = summarizeScenarios([{}]);
  assert.equal(s.scenario_id, "(unknown)");
  assert.equal(s.score_median, null);
  assert.equal(s.latest_started_at, null);
  assert.equal(s.kinds.other, 1);
  assert.deepEqual(runRows(undefined, "a"), []);
});
