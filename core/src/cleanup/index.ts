import type { RunWorkspace } from "../types.js";

/**
 * Resets all per-run state so the next run starts from the baseline. Cleanup
 * must robustly recover even leftover/partial faults (aggressive reset).
 */
export interface Cleanup {
  /**
   * Tear down one run: reset the run workspace, tear down the deployment,
   * redeploy the baseline (buggy) image, and stop any injected load.
   */
  reset(workspace: RunWorkspace): Promise<void>;
}

export { ComposeCleanup } from "./cleanup.js";
