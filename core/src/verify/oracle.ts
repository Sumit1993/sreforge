import type { OracleScore, OracleSignal } from "../types.js";
import type { Oracle, OracleContext } from "./index.js";

/** An oracle paired with its relative weight inside a composition. */
export interface WeightedOracle {
  readonly oracle: Oracle;
  readonly weight: number;
}

/**
 * Composes weighted sub-oracles into a single normalized score (SREGym's
 * `CompoundedOracle`). The taxonomy is detect → diagnose → mitigate; v1
 * composes only a {@link MitigationOracle}, but the contract is fixed so adding
 * a `DiagnosisOracle` later is just another entry in `oracles`.
 *
 * Aggregate score is the weight-normalized sum of sub-scores; the composition
 * passes when its aggregate clears `passThreshold`.
 */
export class CompoundedOracle implements Oracle {
  readonly id: string;
  readonly #oracles: readonly WeightedOracle[];
  readonly #passThreshold: number;

  constructor(
    oracles: readonly WeightedOracle[],
    options: { readonly id?: string; readonly passThreshold?: number } = {},
  ) {
    if (oracles.length === 0) {
      throw new Error("CompoundedOracle requires at least one sub-oracle");
    }
    this.#oracles = oracles;
    this.id = options.id ?? "compounded";
    this.#passThreshold = options.passThreshold ?? 1;
  }

  async evaluate(ctx: OracleContext): Promise<OracleScore> {
    const subScores = await Promise.all(
      this.#oracles.map((entry) => entry.oracle.evaluate(ctx)),
    );

    const totalWeight = this.#oracles.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    const weightedSum = this.#oracles.reduce(
      (sum, entry, index) => sum + entry.weight * scoreAt(subScores, index),
      0,
    );
    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const signals: readonly OracleSignal[] = this.#oracles.map(
      (entry, index) => ({
        id: entry.oracle.id,
        satisfied: scoreAt(subScores, index) >= 1,
        value: scoreAt(subScores, index),
        weight: entry.weight,
        detail: `sub-oracle ${entry.oracle.id} scored ${scoreAt(
          subScores,
          index,
        ).toFixed(3)}`,
      }),
    );

    return {
      oracleId: this.id,
      score,
      passed: score >= this.#passThreshold,
      signals,
      subScores,
    };
  }
}

/** Safe indexed read into the sub-score array under noUncheckedIndexedAccess. */
function scoreAt(subScores: readonly OracleScore[], index: number): number {
  return subScores[index]?.score ?? 0;
}
