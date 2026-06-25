import type { AgentContext, Trigger } from "../types.js";

/**
 * The neutral, programmatic brief handed to the agent at t=0.
 *
 * Framing is honest and neutral (D8): it describes a real incident on a real
 * deployment and never mentions a harness, an evaluation, or a "correct" fix.
 * `prompt` is the rendered text; the structured fields are kept so a runner can
 * present the brief however its meta-harness prefers.
 */
export interface AgentBrief {
  /** Rendered, human-readable incident brief (the "programmatic prompt"). */
  readonly prompt: string;
  /** The firing alert that opened the incident. */
  readonly alertName: string;
  /** Endpoints + workspace + submit command, passed through verbatim. */
  readonly context: AgentContext;
}

/**
 * Turns a {@link Trigger} plus an {@link AgentContext} into an {@link AgentBrief}.
 *
 * The assembler is pure and deterministic: same inputs → same brief. It adds no
 * harness/eval framing and invents no facts beyond what the trigger and context
 * already carry.
 */
export class ContextAssembler {
  assemble(trigger: Trigger, context: AgentContext): AgentBrief {
    return {
      // The trigger is what OPENED the incident; the agent is not handed its
      // contents. It reads the live, firing alerts off the alerting stack itself
      // (the endpoints below) the way a real on-call would — see renderPrompt.
      prompt: renderPrompt(context),
      alertName: trigger.alertName,
      context,
    };
  }
}

/**
 * Renders the neutral incident brief — a page, not a diagnosis.
 *
 * It deliberately does NOT name the firing alert or restate its summary: the
 * agent picks the active alerts up from the alerting stack (Alertmanager /
 * Prometheus) and queries on from there for the signals behind them, exactly as
 * a real responder does. Pre-digesting the alert would both spoon-feed the
 * diagnosis and read like a benchmark prompt rather than a real page.
 *
 * Every value shown is the AGENT's view: in-network endpoint DNS and the
 * in-sandbox source path — never a host port or a host filesystem path.
 */
function renderPrompt(context: AgentContext): string {
  const endpoints = Object.entries(context.services)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, url]) => `  - ${name}: ${url}`)
    .join("\n");

  const sourcePath = context.workspacePath ?? "/workspace";

  return [
    `You are the on-call engineer for the ${context.runWorkspace.service} service.`,
    "",
    "One or more alerts are currently firing for this service. The alerting and",
    "metrics stack is the source of truth — start there to see what is active and",
    "the signals behind it, then work back to the cause in the service.",
    "",
    "Endpoints:",
    endpoints,
    "",
    `The service source is checked out at: ${sourcePath}`,
    "",
    "Investigate, edit the source in place to resolve the incident, then submit",
    "your change with:",
    `  ${context.submitCommand}`,
  ].join("\n");
}
