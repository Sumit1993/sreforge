// =============================================================================
// tools/runs-dashboard/lib.mjs — pure aggregation over parsed run records.
//
// No I/O, no server, no node built-ins: every function here takes already-parsed
// record objects (the JSON under <store>/records/*.json) and returns plain data.
// That is what makes the arithmetic testable without standing a server up
// (tools/runs-dashboard/test/lib.test.mjs).
//
// Records are the ADR-0026 full run-record shape:
//   { run_id, scenario_id, verdict, score {oracle_id, passed, score, signals[]},
//     started_at, finished_at, timings, agent_transcript {harness, model, ...} }
// The loader additionally attaches `sha256` (the record's content hash, which is
// also its filename) so the UI can link a row to GET /api/run/<sha256>.
// =============================================================================

/** Run kinds derived from the `run_id` prefix. `other` is the catch-all. */
export const RUN_KINDS = ["campaign", "smoke-pos", "smoke-neg", "poscontrol", "run", "other"];

// Ordered longest-prefix-first so `smoke-pos`/`smoke-neg` are decided before any
// shorter prefix could claim them.
const KIND_PREFIXES = [
  ["smoke-pos", "smoke-pos"],
  ["smoke-neg", "smoke-neg"],
  ["campaign-", "campaign"],
  ["poscontrol-", "poscontrol"],
  ["run-", "run"],
];

/**
 * Explicit "the agent fell for the decoy" signal ids. The oracle in the live
 * store emits only the generic mitigation signal set (ci_green, alert_cleared,
 * sustained_clear, time_to_clear, no_new_alerts) — none of which means
 * "fell for the decoy" — so this stays dormant against today's data and the
 * summary falls back to the plain pass/fail split. Deliberately NOT widened to
 * guesses: inventing decoy semantics would misreport the eval.
 */
export const DECOY_SIGNAL_IDS = new Set(["falls_for_decoy", "fell_for_decoy"]);

export const PASS_RATE_LABEL = "pass rate";
export const DECOY_RATE_LABEL = "decoy rate";

/** `campaign-latency-3` → `campaign`; unknown prefixes → `other`. */
export function runKind(runId) {
  const id = String(runId ?? "");
  for (const [prefix, kind] of KIND_PREFIXES) if (id.startsWith(prefix)) return kind;
  return "other";
}

/**
 * Median of the finite numbers in `values`; null when there are none.
 * Only real numbers count — `Number(null)` is 0, so coercing first would let a
 * missing score drag the median down as if it were a zero.
 */
export function median(values) {
  const nums = (values ?? []).filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** A record passed when its verdict is `passed` (`failed` and `rejected` do not). */
export const isPassed = (rec) => rec?.verdict === "passed";

export const isDecoyScenario = (scenarioId) => String(scenarioId ?? "").startsWith("decoy-");

/** The explicit fell-for-decoy signal on a record, or null when absent. */
export function decoySignal(rec) {
  const signals = rec?.score?.signals;
  if (!Array.isArray(signals)) return null;
  return signals.find((s) => DECOY_SIGNAL_IDS.has(s?.id)) ?? null;
}

const durationMs = (rec) => {
  const a = Date.parse(rec?.started_at ?? ""), b = Date.parse(rec?.finished_at ?? "");
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
};

/**
 * Per-scenario aggregates, newest-active scenario first.
 *
 * Each row: run count, pass count / pass rate, median score, latest started_at,
 * distinct models, the run-kind split, and a rate column that is the decoy rate
 * only when the records actually carry an explicit decoy signal.
 */
export function summarizeScenarios(records) {
  const byScenario = new Map();
  for (const rec of records ?? []) {
    const id = rec?.scenario_id ?? "(unknown)";
    if (!byScenario.has(id)) byScenario.set(id, []);
    byScenario.get(id).push(rec);
  }

  const rows = [];
  for (const [scenario_id, recs] of byScenario) {
    const kinds = Object.fromEntries(RUN_KINDS.map((k) => [k, 0]));
    for (const r of recs) kinds[runKind(r?.run_id)]++;

    const passed = recs.filter(isPassed).length;
    const models = [...new Set(recs.map((r) => r?.agent_transcript?.model).filter(Boolean))].sort();
    const started = recs.map((r) => r?.started_at).filter(Boolean).sort();
    const decoyed = recs.map(decoySignal).filter(Boolean);

    // Decoy column only when the store gives us an unambiguous signal; otherwise
    // the honest fallback is the pass/fail split, labelled "pass rate".
    const decoy_signalled = isDecoyScenario(scenario_id) && decoyed.length > 0;
    const rate = decoy_signalled
      ? decoyed.filter((s) => s.satisfied === true).length / decoyed.length
      : (recs.length ? passed / recs.length : null);

    rows.push({
      scenario_id,
      decoy: isDecoyScenario(scenario_id),
      runs: recs.length,
      passed,
      pass_rate: recs.length ? passed / recs.length : null,
      score_median: median(recs.map((r) => r?.score?.score)),
      latest_started_at: started.length ? started[started.length - 1] : null,
      models,
      kinds,
      rate,
      rate_label: decoy_signalled ? DECOY_RATE_LABEL : PASS_RATE_LABEL,
    });
  }

  // Most-recently-exercised scenario first; scenarios with no timestamp sink.
  rows.sort((a, b) => String(b.latest_started_at ?? "").localeCompare(String(a.latest_started_at ?? "")));
  return rows;
}

/** Flat rows for one scenario's runs, newest first. */
export function runRows(records, scenarioId) {
  return (records ?? [])
    .filter((r) => r?.scenario_id === scenarioId)
    .map((r) => ({
      sha256: r?.sha256 ?? null,
      run_id: r?.run_id ?? null,
      kind: runKind(r?.run_id),
      verdict: r?.verdict ?? null,
      score: Number.isFinite(Number(r?.score?.score)) ? Number(r.score.score) : null,
      oracle_id: r?.score?.oracle_id ?? null,
      started_at: r?.started_at ?? null,
      duration_ms: durationMs(r),
      model: r?.agent_transcript?.model ?? null,
      harness: r?.agent_transcript?.harness ?? null,
      confinement: r?.agent_transcript?.confinement ?? null,
      profile: r?.profile ?? null,
    }))
    .sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
}
