import type { OracleScore, OracleSignal } from "../types.js";
import type { Oracle, OracleContext } from "./index.js";

/** A single firing alert with the labels the oracle scopes on. */
export interface FiringAlert {
  readonly alertName: string;
  /** The alert's `service` label, if any. */
  readonly service?: string;
}

/**
 * Reads the live alert state during behavioral verification. Implementations
 * back this with Prometheus/Alertmanager. Kept as a narrow port so the oracle
 * stays testable and domain-agnostic.
 */
export interface AlertProbe {
  /** True while the named alert is firing. */
  isFiring(alertName: string): Promise<boolean>;
  /** All alerts currently firing (deduped by name) — used to detect regressions. */
  firingAlerts(): Promise<readonly FiringAlert[]>;
  /** Monotonic clock in milliseconds (injectable for determinism/tests). */
  now(): number;
}

/** Configuration for a {@link MitigationOracle}. */
export interface MitigationOracleOptions {
  readonly probe: AlertProbe;
  /**
   * Poll interval in milliseconds while waiting for the alert to clear and
   * while confirming the sustained-clear window.
   */
  readonly pollIntervalMs?: number;
  /** Aggregate threshold in [0, 1] above which the run is "mitigated". */
  readonly passThreshold?: number;
}

/** Weights of the multi-signal score. They sum to 1. */
const SIGNAL_WEIGHTS = {
  ciGreen: 0.25,
  alertCleared: 0.35,
  sustainedClear: 0.2,
  timeToClear: 0.1,
  noNewAlerts: 0.1,
} as const;

const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * The v1 behavioral oracle. Fully objective — no LLM.
 *
 * It scores a multi-signal mitigation under a still-active fault stimulus:
 *   1. CI green (the fix built and passed the substrate's own tests),
 *   2. the target alert clears,
 *   3. it stays cleared for `sustainedClearSeconds` (sustained-clear),
 *   4. time-to-clear within `maxClearTimeSeconds` (partial credit, faster = more),
 *   5. no new alerts fired (no regression).
 *
 * The defining property (the anti-cheat): the harness never stops the fault —
 * only a correctly deployed fix can clear the alert.
 */
export class MitigationOracle implements Oracle {
  readonly id = "mitigation";
  readonly #probe: AlertProbe;
  readonly #pollIntervalMs: number;
  readonly #passThreshold: number;

  constructor(options: MitigationOracleOptions) {
    this.#probe = options.probe;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#passThreshold = options.passThreshold ?? 1;
  }

  async evaluate(ctx: OracleContext): Promise<OracleScore> {
    const { mitigation } = ctx;
    const alert = mitigation.alertToClear;

    // Signal 1 — CI green. If CI was red the fix never deployed; the alert
    // cannot have cleared by any legitimate means, so we short-circuit.
    const ciGreen = ctx.ci?.green ?? false;
    if (!ciGreen) {
      return failClosed(this.id, "ci was not green; fix never deployed");
    }

    // The fix must also have become live. If the CD redeploy failed the alert
    // cannot clear by any legitimate means, so short-circuit rather than burn
    // the full clear budget waiting on a fix that never deployed.
    const deployed = ctx.deploy?.redeployed ?? false;
    if (!deployed) {
      return failClosed(this.id, "deploy did not succeed; fix never became live");
    }

    // Signal 2 — wait (bounded) for the alert to clear.
    const startedAt = this.#probe.now();
    const deadline = startedAt + mitigation.maxClearTimeSeconds * 1_000;
    const clearedAt = await this.#waitForClear(alert, deadline);
    const alertCleared = clearedAt !== null;

    // Signal 4 — time-to-clear, partial credit (sooner is better).
    const timeToClearMs = alertCleared ? clearedAt - startedAt : Number.NaN;
    const timeToClearValue = alertCleared
      ? clamp01(
          1 - timeToClearMs / (mitigation.maxClearTimeSeconds * 1_000),
        )
      : 0;

    // Signal 3 — sustained clear: the alert must stay cleared for the window.
    const sustainedClear = alertCleared
      ? await this.#confirmSustainedClear(
          alert,
          mitigation.sustainedClearSeconds,
        )
      : false;

    // Signal 5 — no new alerts fired (regression check), scoped to the
    // scenario's declared in-scope services and excluding the target.
    const firing = await this.#probe.firingAlerts();
    const scope = mitigation.inScopeServices;
    const otherFiring = firing.filter((a) => a.alertName !== alert);
    const regressions =
      scope === undefined
        ? otherFiring
        : otherFiring.filter(
            (a) => a.service !== undefined && scope.includes(a.service),
          );
    const noNewAlerts = regressions.length === 0;
    const regressionNames = regressions.map((a) => a.alertName);

    const signals: readonly OracleSignal[] = [
      signal("ci_green", ciGreen, ciGreen ? 1 : 0, SIGNAL_WEIGHTS.ciGreen, "CI build + existing tests passed"),
      signal("alert_cleared", alertCleared, alertCleared ? 1 : 0, SIGNAL_WEIGHTS.alertCleared, `alert ${alert} cleared within budget`),
      signal("sustained_clear", sustainedClear, sustainedClear ? 1 : 0, SIGNAL_WEIGHTS.sustainedClear, `alert stayed cleared for ${mitigation.sustainedClearSeconds}s`),
      signal("time_to_clear", alertCleared, timeToClearValue, SIGNAL_WEIGHTS.timeToClear, alertCleared ? `cleared in ${Math.round(timeToClearMs / 1_000)}s` : "did not clear"),
      signal("no_new_alerts", noNewAlerts, noNewAlerts ? 1 : 0, SIGNAL_WEIGHTS.noNewAlerts, noNewAlerts ? "no regression alerts" : `new alerts: ${regressionNames.join(", ")}`),
    ];

    return scoreFrom(this.id, signals, this.#passThreshold);
  }

  /** Polls until the alert clears or the deadline passes. Returns clear time. */
  async #waitForClear(
    alert: string,
    deadline: number,
  ): Promise<number | null> {
    for (;;) {
      if (!(await this.#probe.isFiring(alert))) {
        return this.#probe.now();
      }
      if (this.#probe.now() >= deadline) {
        return null;
      }
      await sleep(this.#pollIntervalMs);
    }
  }

  /** Confirms the alert stays cleared for the full sustained-clear window. */
  async #confirmSustainedClear(
    alert: string,
    sustainedClearSeconds: number,
  ): Promise<boolean> {
    const until = this.#probe.now() + sustainedClearSeconds * 1_000;
    while (this.#probe.now() < until) {
      if (await this.#probe.isFiring(alert)) {
        return false; // flapped back; not sustained
      }
      await sleep(this.#pollIntervalMs);
    }
    return true;
  }
}

/** Builds a single oracle signal. */
function signal(
  id: string,
  satisfied: boolean,
  value: number,
  weight: number,
  detail: string,
): OracleSignal {
  return { id, satisfied, value, weight, detail };
}

/** Weight-normalizes the signals into an {@link OracleScore}. */
function scoreFrom(
  oracleId: string,
  signals: readonly OracleSignal[],
  passThreshold: number,
): OracleScore {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + s.weight * s.value, 0);
  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return { oracleId, score, passed: score >= passThreshold, signals };
}

/** A zeroed, failed score used when verification cannot legitimately proceed. */
function failClosed(oracleId: string, detail: string): OracleScore {
  return {
    oracleId,
    score: 0,
    passed: false,
    signals: [signal("ci_green", false, 0, SIGNAL_WEIGHTS.ciGreen, detail)],
  };
}

/** Clamps a number to the [0, 1] interval. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
