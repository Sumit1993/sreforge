import type { RunWorkspace } from "../types.js";
import type { Cleanup } from "./index.js";

/**
 * Aggressive, idempotent reset for the docker-compose topology. It must leave
 * the substrate in its baseline (buggy) state regardless of how the previous
 * run ended — including partial or leftover faults.
 *
 * Responsibilities (in order):
 *   1. reset the run workspace (discard the agent's edits / re-clone),
 *   2. tear down the deployment,
 *   3. redeploy the baseline image,
 *   4. stop any injected load.
 */
export class ComposeCleanup implements Cleanup {
  reset(_workspace: RunWorkspace): Promise<void> {
    throw new Error("not implemented in v1 scaffold");
  }
}
