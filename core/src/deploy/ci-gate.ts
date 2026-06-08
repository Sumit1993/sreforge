import type { CiResult, MergeResult, RunWorkspace } from "../types.js";
import type { AutoMerge, CiGate } from "./index.js";

/**
 * Runs the substrate's build + existing test suite against the run workspace.
 *
 * The real implementation shells out (e.g. `pnpm build && pnpm test`) inside
 * `workspace.path` and maps the exit status onto {@link CiResult}. It must never
 * add, weaken, or skip tests — the gate is exactly the substrate's own CI.
 */
export class ComposeCiGate implements CiGate {
  run(_workspace: RunWorkspace): Promise<CiResult> {
    throw new Error("not implemented in v1 scaffold");
  }
}

/**
 * Commits a CI-green fix to the run workspace. The presence of the commit is
 * what the CD-on-merge redeploy keys off of (D5 — local run workspace, no
 * github.com in v1).
 */
export class GitAutoMerge implements AutoMerge {
  merge(_workspace: RunWorkspace): Promise<MergeResult> {
    throw new Error("not implemented in v1 scaffold");
  }
}
