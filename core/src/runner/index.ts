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

/**
 * The three {@link AgentRunner} implementations, by what produces the fix —
 * NOT all "mocks". Only the reference runner replays a canned patch; the
 * external runner drives a real agent:
 *
 *   • {@link ExternalAgentRunner}    — REAL. Drives a live external SRE agent
 *       across the sandbox boundary (waits for its `submit` sentinel, captures
 *       its diff, replays it onto the forge). This is the production path.
 *   • {@link ReferenceFixRunner} — REFERENCE. Replays a canned `fix.patch`
 *       (the known-good reference fix) with no agent. Proves the loop end-to-end
 *       and anchors grading; it does not simulate agent behavior.
 *   • {@link NoopAgentRunner}        — PLACEHOLDER. Produces no fix; the default
 *       when no runner is wired (the run records as no-submission).
 */
export { NoopAgentRunner } from "./agent-runner.js";
export { ReferenceFixRunner } from "./reference-fix-runner.js";
export type { ReferenceFixRunnerOptions } from "./reference-fix-runner.js";
export { ExternalAgentRunner } from "./external-agent-runner.js";
export type { ExternalAgentRunnerOptions } from "./external-agent-runner.js";
