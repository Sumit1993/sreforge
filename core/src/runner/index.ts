import type { AgentBrief } from "../context/index.js";
import type { Trajectory } from "../types.js";

/**
 * The boundary where an external agent meta-harness (e.g. t3code) plugs in.
 *
 * An `AgentRunner` is handed the assembled brief and is responsible for driving
 * an agent against the deployment with its tool surface (v1: shell + documented
 * endpoints + `submit`), then collecting the resulting {@link Trajectory}
 * (transcript + produced diff). The engine never inspects how the agent works —
 * only what it produced.
 */
export interface AgentRunner {
  /** Run the agent against the brief and return its trajectory. */
  run(brief: AgentBrief): Promise<Trajectory>;
}

export { NoopAgentRunner } from "./agent-runner.js";
export { ScriptedFixAgentRunner } from "./scripted-fix-runner.js";
export type { ScriptedFixAgentRunnerOptions } from "./scripted-fix-runner.js";
