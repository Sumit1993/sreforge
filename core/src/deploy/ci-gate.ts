import type { CiResult, MergeResult, RunWorkspace } from "../types.js";
import type { AutoMerge, CiGate } from "./index.js";
import type { GiteaClient } from "./gitea-client.js";
import { run } from "./process.js";

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 600_000;

// Gitea Actions reports a run's final state in `status` directly (e.g.
// "success" | "failure" | "cancelled" | "skipped"); GitHub-style runs use
// status="completed" with a separate `conclusion`. Treat any of these as
// terminal and derive green from whichever field carries the outcome.
const TERMINAL_STATES = new Set([
  "completed",
  "success",
  "failure",
  "failed",
  "cancelled",
  "canceled",
  "skipped",
  "error",
]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a git value from the workspace (e.g. HEAD sha, current branch). */
async function git(workspacePath: string, args: readonly string[]): Promise<string> {
  const result = await run("git", ["-C", workspacePath, ...args]);
  return result.code === 0 ? result.stdout.trim() : "";
}

/** Configuration for {@link GiteaCiGate}. */
export interface GiteaCiGateOptions {
  readonly client: GiteaClient;
  /** Poll interval while waiting for the run to complete. */
  readonly pollIntervalMs?: number;
  /** Max time to wait for CI to complete before declaring it not-green. */
  readonly timeoutMs?: number;
}

/**
 * The CI gate, driven by Gitea Actions. The agent's submit step has already
 * pushed the fix branch (which triggers `.gitea/workflows/ci.yml`); this gate
 * polls the Actions run for the workspace's HEAD commit and maps its conclusion
 * onto {@link CiResult}. It never adds, weakens, or skips the workflow — the
 * gate is exactly the substrate's own CI (build + smoke).
 *
 * A red gate means the fix never deploys and the firing alert persists; the
 * output is surfaced to the agent as feedback.
 */
export class GiteaCiGate implements CiGate {
  readonly #client: GiteaClient;
  readonly #pollMs: number;
  readonly #timeoutMs: number;

  constructor(options: GiteaCiGateOptions) {
    this.#client = options.client;
    this.#pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run(workspace: RunWorkspace): Promise<CiResult> {
    const startedAt = Date.now();
    const sha = await git(workspace.path, ["rev-parse", "HEAD"]);
    if (!sha) {
      return { green: false, output: "could not resolve workspace HEAD", durationMs: Date.now() - startedAt };
    }

    const deadline = startedAt + this.#timeoutMs;
    for (;;) {
      let status = null;
      try {
        status = await this.#client.ciRunForSha(sha);
      } catch {
        // forge not ready / transient — retry until the deadline.
      }
      if (status && TERMINAL_STATES.has(status.status)) {
        const green =
          status.status === "success" || status.conclusion === "success";
        const where = status.url ? ` (${status.url})` : "";
        const outcome = status.conclusion ?? status.status;
        return {
          green,
          output: `CI ${outcome} for ${sha.slice(0, 8)}${where}`,
          durationMs: Date.now() - startedAt,
        };
      }
      if (Date.now() >= deadline) {
        return {
          green: false,
          output: `CI did not complete within ${Math.round(this.#timeoutMs / 1000)}s for ${sha.slice(0, 8)}`,
          durationMs: Date.now() - startedAt,
        };
      }
      await sleep(this.#pollMs);
    }
  }
}

/** Configuration for {@link GiteaAutoMerge}. */
export interface GiteaAutoMergeOptions {
  readonly client: GiteaClient;
}

/**
 * Merges the green fix's PR in the local Gitea forge. The workspace's current
 * branch identifies the open PR; merging it records the fix on the forge and
 * marks the gate→merge→deploy lifecycle complete. The agent never merges.
 *
 * The deployment itself rebuilds from the run workspace tree (which already
 * holds the merged content), so the redeploy does not depend on the forge's
 * branch topology — see {@link ComposeCdDeployer}.
 */
export class GiteaAutoMerge implements AutoMerge {
  readonly #client: GiteaClient;

  constructor(options: GiteaAutoMergeOptions) {
    this.#client = options.client;
  }

  async merge(workspace: RunWorkspace): Promise<MergeResult> {
    const branch = await git(workspace.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch || branch === "HEAD") {
      return { merged: false };
    }
    const pr = await this.#client.openPrForBranch(branch);
    if (!pr) {
      return { merged: false };
    }
    const outcome = await this.#client.mergePr(pr.index);
    return { merged: outcome.merged, commit: outcome.sha };
  }
}
