import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBrief } from "../context/index.js";
import type { GiteaClient } from "../deploy/index.js";
import { run } from "../deploy/process.js";
import type { Trajectory } from "../types.js";
import type { AgentRunner } from "./index.js";

/** Configuration for an {@link ExternalAgentRunner}. */
export interface ExternalAgentRunnerOptions {
  /** Forge client used to open the PR for the fix branch. */
  readonly client: GiteaClient;
  /**
   * Absolute path to the CLEAN, de-tell'd workspace the external agent edits
   * inside the sandbox (host side of the `/workspace` bind mount, e.g.
   * `.run-workspace/booklogr`). This clone sits at the SAME regressed HEAD as
   * the forge substrate; the agent's `submit` shim commits its edits here and
   * drops the completion sentinel. NEVER the substrate — the agent never
   * touches the forge-connected clone.
   */
  readonly cleanWorkspacePath: string;
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
  /** Name surfaced in the {@link Trajectory} (defaults to `"external"`). */
  readonly agentName?: string;
  /**
   * Path of the completion sentinel relative to {@link cleanWorkspacePath}.
   * Written by the `submit` shim. Defaults to `".sreforge/submit.json"`.
   */
  readonly sentinelRelPath?: string;
  /**
   * How long to wait for the sentinel before giving up. On timeout the runner
   * returns `submitted: false` and the conductor records the run as failed.
   * Defaults to 30 minutes.
   */
  readonly submitTimeoutMs?: number;
  /** Poll interval while waiting for the sentinel. Defaults to 2 seconds. */
  readonly pollIntervalMs?: number;
}

/** Shape of the sentinel the `submit` shim writes to the clean workspace. */
interface SubmitSentinel {
  /** ISO-8601 timestamp of the submission. */
  readonly submittedAt: string;
  /** HEAD sha of the clean clone at submission time. */
  readonly headSha: string;
  /** Optional agent-supplied note. */
  readonly note?: string;
}

/**
 * Drives a REAL external SRE agent's submission across the sandbox boundary and
 * onto the forge substrate — the engine-side counterpart of the sandbox `submit`
 * shim.
 *
 * The agent edits a CLEAN, de-tell'd clone (`cleanWorkspacePath`, the host side
 * of the `/workspace` bind mount) and, on completion, runs `submit`, which
 * commits those edits and writes a completion sentinel. This runner:
 *
 *   1. polls the clean workspace for the sentinel (the completion signal),
 *   2. captures the agent's diff FROM THE CLEAN CLONE (excluding the sentinel),
 *   3. replays that diff onto the FORGE substrate exactly as
 *      {@link ScriptedFixAgentRunner} replays a canned patch — checkout a fresh
 *      fix branch at the same regressed HEAD, `git apply`, commit under project
 *      authorship, push (fires substrate CI), open the PR,
 *   4. returns the {@link Trajectory} (submitted + the produced diff).
 *
 * The diff crosses the boundary purely through the shared filesystem mount — no
 * network back to the engine, no forge access inside the sandbox. Because both
 * clones sit at the identical regressed HEAD, the clean-clone diff applies
 * cleanly to the substrate; the conductor's CI → merge → redeploy → verify →
 * cleanup then proceed byte-identically to the scripted path, because they all
 * key off the substrate (`runWorkspace.path`), which is exactly where this
 * runner lands the fix.
 *
 * Only the patch SOURCE differs from {@link ScriptedFixAgentRunner} (a live
 * agent diff vs. a canned `fix.patch`); the engine-side steps are identical.
 */
export class ExternalAgentRunner implements AgentRunner {
  readonly #opts: ExternalAgentRunnerOptions;

  constructor(options: ExternalAgentRunnerOptions) {
    this.#opts = options;
  }

  async run(brief: AgentBrief): Promise<Trajectory> {
    const start = Date.now();
    const o = this.#opts;
    const agentName = o.agentName ?? "external";
    const clean = o.cleanWorkspacePath;
    const substrate = brief.context.runWorkspace.path;
    const sentinelRel = o.sentinelRelPath ?? ".sreforge/submit.json";
    const sentinelPath = join(clean, sentinelRel);
    const timeoutMs = o.submitTimeoutMs ?? 30 * 60 * 1000;
    const pollMs = o.pollIntervalMs ?? 2_000;

    const transcript: string[] = [
      `external-agent runner for alert ${brief.alertName}`,
      `clean workspace ${clean}`,
      `awaiting sentinel ${sentinelRel} (timeout ${timeoutMs}ms)`,
    ];

    // (a) Wait for the agent's completion signal. On timeout, return a
    //     not-submitted trajectory — the conductor records the run as failed.
    const sentinel = await this.#waitForSentinel(sentinelPath, timeoutMs, pollMs);
    if (sentinel === null) {
      transcript.push("timed out waiting for submission");
      return {
        agentName,
        transcript: transcript.join("\n"),
        diff: "",
        submitted: false,
        durationMs: Date.now() - start,
      };
    }
    transcript.push(
      `submission received at ${sentinel.submittedAt} (head ${sentinel.headSha})`,
    );
    if (sentinel.note) {
      transcript.push(`agent note: ${sentinel.note}`);
    }

    // The agent's diff is anchored at the regressed base both clones share. The
    // substrate's HEAD IS that base (both clones were cut at the identical
    // regressed sha). The `submit` shim commits the agent's edits onto a local
    // `submission` branch in the clean clone, so the clean clone's HEAD is that
    // base + the submission — diffing the clean tree against the shared base sha
    // therefore captures exactly the agent's edits (committed AND any residual
    // uncommitted ones), independent of how many submission commits there are.
    const base = (await this.#git(substrate, ["rev-parse", "HEAD"])).stdout.trim();

    // Risk mitigation: the diff must apply at the IDENTICAL regressed HEAD the
    // substrate is on. If prepare-agent-workspace.sh ever cloned from a different
    // ref, the shared base sha would be absent from the clean clone; assert it is
    // reachable there and fail loud (mirrors scripted-fix's fail-on-bad-patch).
    const baseInClean = await run(
      "git",
      ["cat-file", "-e", `${base}^{commit}`],
      { cwd: clean },
    );
    if (baseInClean.code !== 0) {
      throw new Error(
        `clean clone and substrate are not at the same regressed HEAD ` +
          `(substrate HEAD ${base} is not present in the clean clone ` +
          `${clean}); the agent diff cannot be replayed cleanly — regenerate ` +
          `the clean workspace from the current substrate HEAD`,
      );
    }

    // (b) Stage any residual uncommitted edits (so the worktree diff is complete),
    //     then capture the diff from the shared base to the clean worktree.
    //     `--binary` carries binary blobs so `git apply --binary` can replay them;
    //     `.sreforge` is excluded so the sentinel is never replayed onto the
    //     substrate (it would be a rig tell in the forge history).
    await this.#git(clean, ["add", "-A"]);
    const diff = (
      await this.#git(clean, [
        "diff",
        "--binary",
        "--no-color",
        base,
        "--",
        ".",
        ":(exclude).sreforge",
      ])
    ).stdout;

    // An empty diff means the agent submitted no edits. Return submitted with an
    // empty diff — the conductor's existing guard short-circuits to failed
    // (no fix produced), the correct outcome. No branch/push/PR happens.
    if (diff.trim() === "") {
      transcript.push("submission contained no edits (empty diff)");
      return {
        agentName,
        transcript: transcript.join("\n"),
        diff: "",
        submitted: true,
        durationMs: Date.now() - start,
      };
    }

    // (c) Replay on the FORGE substrate, mirroring ScriptedFixAgentRunner.

    // 1. Put the fix on a fresh, named branch at the substrate's regressed HEAD.
    await this.#git(substrate, ["checkout", "-B", o.branch]);

    // 2. Apply the captured diff via a temp .patch file. `--binary` replays
    //    binary blobs; a 3-way fallback recovers from benign context drift.
    //    A failure here is a setup/fidelity bug — fail loud.
    const tmpDir = await mkdtemp(join(tmpdir(), "sreforge-ext-"));
    const patchPath = join(tmpDir, "submission.patch");
    try {
      await writeFile(patchPath, diff, "utf8");
      const apply = await run("git", ["apply", "--binary", patchPath], {
        cwd: substrate,
      });
      if (apply.code !== 0) {
        const apply3 = await run(
          "git",
          ["apply", "--binary", "--3way", patchPath],
          { cwd: substrate },
        );
        if (apply3.code !== 0) {
          throw new Error(
            `git apply of the agent diff failed on the substrate ` +
              `(exit ${apply.code}): ${apply.stderr.trim()}`,
          );
        }
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    // 3-4. Commit it under project authorship (de-tell: the forge history reads
    //      as the maintainer's own change, never the agent's neutral identity).
    await this.#git(substrate, ["add", "-A"]);
    await this.#git(substrate, ["commit", "-m", o.commitMessage], {
      GIT_AUTHOR_NAME: o.authorName ?? "Dev",
      GIT_AUTHOR_EMAIL: o.authorEmail ?? "dev@localhost",
      GIT_COMMITTER_NAME: o.authorName ?? "Dev",
      GIT_COMMITTER_EMAIL: o.authorEmail ?? "dev@localhost",
    });

    // 5. Record the diff as committed on the substrate (the Trajectory artifact).
    const recordedDiff = (
      await this.#git(substrate, ["diff", "--no-color", "HEAD~1", "HEAD"])
    ).stdout;

    // 6. Push the branch — fires the substrate CI run the gate polls for.
    await this.#git(substrate, ["push", "origin", o.branch]);

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
    transcript.push(
      `applied agent diff on branch ${o.branch}`,
      `pushed to origin; ${prNote}`,
    );

    return {
      agentName,
      transcript: transcript.join("\n"),
      diff: recordedDiff,
      submitted: true,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Polls for the sentinel until it is present, parses, AND has a stable mtime,
   * or returns null on timeout. The stable-mtime + JSON-parse gate guards
   * against reading a half-written file mid-rename (the shim writes atomically,
   * but a re-submission can rewrite it).
   */
  async #waitForSentinel(
    path: string,
    timeoutMs: number,
    pollMs: number,
  ): Promise<SubmitSentinel | null> {
    const deadline = Date.now() + timeoutMs;
    let lastMtime = -1;
    for (;;) {
      let mtime: number | null = null;
      try {
        mtime = (await stat(path)).mtimeMs;
      } catch {
        mtime = null; // not present yet
      }
      if (mtime !== null) {
        if (mtime === lastMtime) {
          // Stable for one poll: safe to read.
          const parsed = await this.#readSentinel(path);
          if (parsed !== null) {
            return parsed;
          }
          // Present but unparseable even when stable — keep waiting (a partial
          // write that never settles is treated as not-yet-submitted).
        }
        lastMtime = mtime;
      }
      if (Date.now() >= deadline) {
        return null;
      }
      await delay(pollMs);
    }
  }

  /** Reads + parses the sentinel, returning null if absent or not yet valid JSON. */
  async #readSentinel(path: string): Promise<SubmitSentinel | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }
    try {
      const obj = JSON.parse(raw) as Partial<SubmitSentinel>;
      if (typeof obj.submittedAt === "string" && typeof obj.headSha === "string") {
        return {
          submittedAt: obj.submittedAt,
          headSha: obj.headSha,
          note: typeof obj.note === "string" ? obj.note : undefined,
        };
      }
      return null;
    } catch {
      return null; // mid-write / not valid JSON yet
    }
  }

  /** Runs a git subcommand in a workspace, throwing on non-zero exit. */
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

/** Promise-based delay used by the sentinel poll loop. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
