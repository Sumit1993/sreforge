import type { DeployResult } from "../types.js";
import type { CdDeployer } from "./index.js";

/**
 * Redeploys a single service on the docker-compose topology by rebuilding its
 * image and swapping the container (compose rebuild + swap), then waits for the
 * service to report ready.
 *
 * This is the CD-on-merge step: it runs only after the CI gate is green and the
 * fix has been merged into the run workspace. The agent never deploys.
 */
export class ComposeCdDeployer implements CdDeployer {
  redeploy(_service: string): Promise<DeployResult> {
    throw new Error("not implemented in v1 scaffold");
  }
}
