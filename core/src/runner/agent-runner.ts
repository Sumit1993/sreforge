import type { AgentBrief } from "../context/index.js";
import type { Trajectory } from "../types.js";
import type { AgentRunner } from "./index.js";

/**
 * A placeholder runner that produces no fix.
 *
 * It exists so the engine wiring typechecks and the lifecycle can be exercised
 * end-to-end before a real meta-harness is connected. The real implementation
 * lives behind this same {@link AgentRunner} interface.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  t3code INTEGRATION SEAM
 *  -----------------------
 *  Replace NoopAgentRunner with a `T3CodeAgentRunner implements AgentRunner`
 *  that:
 *    1. resolves the agent entry from an `agents.yaml`-style registry,
 *    2. launches the agent's kickoff command against `brief.context`
 *       (shell + documented endpoints + `submit`),
 *    3. waits for `submit`, then captures the harness transcript and the final
 *       `git diff` of the run workspace,
 *    4. returns them as a Trajectory.
 *  The engine depends only on the interface above — no engine code changes when
 *  this seam is filled.
 * ──────────────────────────────────────────────────────────────────────────
 */
export class NoopAgentRunner implements AgentRunner {
  async run(brief: AgentBrief): Promise<Trajectory> {
    return {
      agentName: "noop",
      transcript: `noop runner: no agent connected for alert ${brief.alertName}`,
      diff: "",
      submitted: false,
      durationMs: 0,
    };
  }
}
