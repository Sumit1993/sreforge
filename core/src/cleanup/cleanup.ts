import type { RunWorkspace } from "../types.js";
import type { Cleanup } from "./index.js";
import { run } from "../deploy/process.js";

const DEFAULT_TIMEOUT_MS = 300_000;

/** Configuration for {@link ComposeCleanup}. */
export interface ComposeCleanupOptions {
  /** Path to the docker-compose file for the deployment. */
  readonly composeFile: string;
  /** Optional compose project name (`-p`). */
  readonly projectName?: string;
  /**
   * Git ref the substrate build context is reset to between runs — the baseline
   * (which INCLUDES the authored regression), NOT the fixed state. Defaults to
   * `origin/baseline`: an immutable ref the import creates and that auto-merge
   * never advances. (Resetting to `origin/main` would be wrong — auto-merge
   * lands the fix on `main`, so `main` no longer reflects the baseline.)
   */
  readonly baselineRef?: string;
  readonly timeoutMs?: number;
}

/**
 * Aggressive, idempotent reset for the docker-compose deployment. Leaves the
 * substrate in its baseline (regressed) state regardless of how the previous
 * run ended. Always runs, even on failure.
 *
 * Steps:
 *   1. discard the agent's edits in the run workspace (git reset --hard + clean),
 *   2. restore the build context to the baseline ref,
 *   3. redeploy the baseline image (compose rebuild + swap).
 *
 * Stopping injected load (k6) is wired in M2, where the load driver is a
 * separate compose service whose lifecycle the scenario owns. The defining
 * invariant (ADR-0004) is that the fault stimulus is never stopped DURING a run — only
 * reset between runs.
 */
export class ComposeCleanup implements Cleanup {
  readonly #composeFile: string;
  readonly #projectName: string | undefined;
  readonly #baselineRef: string;
  readonly #timeoutMs: number;

  constructor(options: ComposeCleanupOptions) {
    this.#composeFile = options.composeFile;
    this.#projectName = options.projectName;
    this.#baselineRef = options.baselineRef ?? "origin/baseline";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async reset(workspace: RunWorkspace): Promise<void> {
    // 1. discard the agent's edits.
    await run("git", ["-C", workspace.path, "reset", "--hard"]);
    await run("git", ["-C", workspace.path, "clean", "-fd"]);

    // 2. restore the build context to the baseline ref.
    await run("git", ["-C", workspace.path, "fetch", "origin", "--prune", "--quiet"]);
    await run("git", ["-C", workspace.path, "reset", "--hard", this.#baselineRef]);

    // 3. redeploy the baseline service.
    await run(
      "docker",
      [...this.#composeArgs(), "up", "-d", "--build", workspace.service],
      { timeoutMs: this.#timeoutMs },
    );
  }

  #composeArgs(): string[] {
    const base = ["compose"];
    if (this.#projectName) base.push("-p", this.#projectName);
    base.push("-f", this.#composeFile);
    return base;
  }
}
