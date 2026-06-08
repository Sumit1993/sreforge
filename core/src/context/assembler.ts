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
      prompt: renderPrompt(trigger, context),
      alertName: trigger.alertName,
      context,
    };
  }
}

/** Renders the neutral incident brief text. */
function renderPrompt(trigger: Trigger, context: AgentContext): string {
  const summary =
    trigger.annotations.summary ??
    trigger.annotations.description ??
    `Alert ${trigger.alertName} is firing.`;

  const endpoints = Object.entries(context.services)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, url]) => `  - ${name}: ${url}`)
    .join("\n");

  return [
    `An alert is currently firing on the ${context.runWorkspace.service} service.`,
    "",
    `Alert: ${trigger.alertName}`,
    `Since: ${trigger.firedAt}`,
    `Summary: ${summary}`,
    "",
    "Available endpoints:",
    endpoints,
    "",
    `Service source is checked out at: ${context.runWorkspace.path}`,
    "",
    "Investigate the deployment, edit the service source in place to resolve the",
    "issue, then submit your change with:",
    `  ${context.submitCommand}`,
  ].join("\n");
}
