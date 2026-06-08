import type {
  CiResult,
  DeployResult,
  MitigationCriteria,
  OracleScore,
  Trajectory,
  Trigger,
} from "../types.js";

/**
 * Everything an oracle may read when scoring a run. Kept deliberately broad so
 * later oracles (detection, diagnosis) can be added without changing this
 * contract — they simply read more of it.
 */
export interface OracleContext {
  readonly trigger: Trigger;
  readonly trajectory: Trajectory;
  readonly ci: CiResult | null;
  readonly deploy: DeployResult | null;
  readonly mitigation: MitigationCriteria;
}

/**
 * The behavioral oracle. v1 oracles are fully objective (no LLM). The taxonomy
 * is detect → diagnose → mitigate; v1 ships only mitigate. A future
 * `DiagnosisOracle` (LLM-judge) implements this same interface and drops into a
 * {@link CompoundedOracle} as one more weighted sub-oracle — no refactor.
 */
export interface Oracle {
  /** Stable oracle id, e.g. `"mitigation"`. */
  readonly id: string;
  evaluate(ctx: OracleContext): Promise<OracleScore>;
}

export { CompoundedOracle } from "./oracle.js";
export type { WeightedOracle } from "./oracle.js";
export { MitigationOracle } from "./mitigation-oracle.js";
export type { AlertProbe, MitigationOracleOptions } from "./mitigation-oracle.js";
