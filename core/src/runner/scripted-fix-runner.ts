import type { AgentBrief } from "../context/index.js";
import type { GiteaClient } from "../deploy/index.js";
import { run } from "../deploy/process.js";
import type { Trajectory } from "../types.js";
import type { AgentRunner } from "./index.js";

/** Configuration for a {@link ScriptedFixAgentRunner}. */
export interface ScriptedFixAgentRunnerOptions {
  /** Forge client used to open the PR for the fix branch. */
  readonly client: GiteaClient;
  /**
   * Absolute path to a unified-diff patch — the reference solution applied to
   * the run workspace. For a negative/anti-cheat run this can be a patch that
   * builds but does not fix (CI green, alert never clears) or one that breaks
   * the build (CI red).
   */
  readonly patchPath: string;
  /**
   * Branch the fix is committed onto and pushed to. MUST be unique per run and
   * MUST NOT be the forge default branch (auto-merge rejects the default branch
   * and a detached HEAD).
   */
  readonly branch: string;
  /** Base branch the PR merges into (the forge default, e.g. `"main"`). */
  readonly base: string;
  /** Commit subject presented in the forge history (neutral, no harness vocab). */
  readonly commitMessage: string;
  /** PR title (defaults to the commit message). */
  readonly prTitle?: string;
  /** Commit author identity (defaults to a plausible developer). */
  readonly authorName?: string;
  readonly authorEmail?: string;
  /** Name surfaced in the {@link Trajectory} (defaults to `"scripted-fix"`). */
  readonly agentName?: string;
}

/**
 * A deterministic stand-in for the agent meta-harness (M5).
 *
 * It plays the golden-path actor so the conductor's automation — CI gate →
 * auto-merge → redeploy → behavioral oracle → cleanup — can be exercised
 * end-to-end before a real agent is connected behind the same
 * {@link AgentRunner} interface. It performs exactly the work a real agent's
 * `submit` step must perform, which the engine assumes has already happened by
 * the time the deploy stage runs:
 *
 *   1. apply the reference patch to the run workspace,
 *   2. commit it onto a per-run fix branch (named, not the default branch),
 *   3. push that branch to the forge (this fires the substrate's CI workflow),
 *   4. open the PR for the branch (auto-merge later looks it up and merges it),
 *   5. return the Trajectory (submitted + the produced diff).
 *
 * It is NOT a shipped eval artifact: in a real eval the agent authors the fix.
 * The reference fix itself lives in the scenario (its `solution/fix.patch`),
 * never hard-coded here — so this runner stays domain-agnostic and reusable.
 */
export class ScriptedFixAgentRunner implements AgentRunner {
  readonly #opts: ScriptedFixAgentRunnerOptions;

  constructor(options: ScriptedFixAgentRunnerOptions) {
    this.#opts = options;
  }

  async run(brief: AgentBrief): Promise<Trajectory> {
    const start = Date.now();
    const cwd = brief.context.runWorkspace.path;
    const o = this.#opts;
    const agentName = o.agentName ?? "scripted-fix";

    // 1. Put the fix on a fresh, named branch at the current (regressed) HEAD.
    await this.#git(cwd, ["checkout", "-B", o.branch]);

    // 2. Apply the reference solution. A failure here is a harness/setup bug
    //    (the patch must apply cleanly to the immutable baseline) — fail loud.
    await this.#git(cwd, ["apply", o.patchPath]);

    // 3-4. Commit it as a plausible developer change.
    await this.#git(cwd, ["add", "-A"]);
    await this.#git(cwd, ["commit", "-m", o.commitMessage], {
      GIT_AUTHOR_NAME: o.authorName ?? "Dev",
      GIT_AUTHOR_EMAIL: o.authorEmail ?? "dev@localhost",
      GIT_COMMITTER_NAME: o.authorName ?? "Dev",
      GIT_COMMITTER_EMAIL: o.authorEmail ?? "dev@localhost",
    });

    // 5. Capture the produced diff (the load-bearing Trajectory artifact). An
    //    empty diff means the patch was a no-op — the conductor then records the
    //    run as failed (no fix produced), which is the correct outcome.
    const diff = (
      await this.#git(cwd, ["diff", "--no-color", "HEAD~1", "HEAD"])
    ).stdout;

    // 6. Push the branch — this is what triggers the forge CI run the gate polls
    //    for (keyed on the workspace HEAD sha).
    await this.#git(cwd, ["push", "origin", o.branch]);

    // 7. Open the PR so auto-merge can find and merge it.
    const prIndex = await o.client.createPr(
      o.branch,
      o.base,
      o.prTitle ?? o.commitMessage,
    );
    const prNote =
      prIndex !== null
        ? `opened PR #${prIndex}`
        : "PR open returned null (already open or no diff)";

    return {
      agentName,
      transcript: [
        `scripted-fix runner for alert ${brief.alertName}`,
        `applied ${o.patchPath} on branch ${o.branch}`,
        `pushed to origin; ${prNote}`,
      ].join("\n"),
      diff,
      submitted: true,
      durationMs: Date.now() - start,
    };
  }

  /** Runs a git subcommand in the workspace, throwing on non-zero exit. */
  async #git(
    cwd: string,
    args: readonly string[],
    env?: Record<string, string>,
  ): Promise<{ stdout: string; stderr: string }> {
    const result = await run("git", args, { cwd, env });
    if (result.code !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed (exit ${result.code}): ${result.stderr.trim()}`,
      );
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }
}
