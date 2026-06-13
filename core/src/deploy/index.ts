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

export { GiteaCiGate, GiteaAutoMerge } from "./ci-gate.js";
export type { GiteaCiGateOptions, GiteaAutoMergeOptions } from "./ci-gate.js";
export { ComposeCdDeployer } from "./cd-deployer.js";
export type { ComposeCdDeployerOptions } from "./cd-deployer.js";
export { GiteaClient } from "./gitea-client.js";
export type {
  GiteaClientOptions,
  CiRunStatus,
  PullRequestRef,
} from "./gitea-client.js";
