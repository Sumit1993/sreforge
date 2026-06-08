import type {
  CiResult,
  DeployResult,
  MergeResult,
  RunWorkspace,
} from "../types.js";

/**
 * The CI gate: builds the run workspace and runs its existing tests. Red here
 * means the fix never deploys and the firing alert persists; the output is
 * surfaced to the agent as feedback.
 */
export interface CiGate {
  run(workspace: RunWorkspace): Promise<CiResult>;
}

/**
 * The auto-merge step: commits a green fix to the run workspace, which is what
 * the CD-on-merge redeploy hook keys off of. The agent never performs this.
 */
export interface AutoMerge {
  merge(workspace: RunWorkspace): Promise<MergeResult>;
}

/**
 * The CD redeploy: rebuilds and swaps the affected service's container so the
 * merged fix becomes live. The agent never deploys.
 */
export interface CdDeployer {
  redeploy(service: string): Promise<DeployResult>;
}

export { ComposeCiGate } from "./ci-gate.js";
export { GitAutoMerge } from "./ci-gate.js";
export { ComposeCdDeployer } from "./cd-deployer.js";
