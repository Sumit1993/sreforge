import type { AgentContext, Trigger } from "../types.js";

/**
 * The neutral incident PAGE handed to the agent at t=0 — a page, not a brief.
 *
 * Framing is honest and neutral (ADR-0008): it describes a real incident on a real
 * deployment and never mentions a harness, an evaluation, or a "correct" fix.
 * `prompt` is the rendered page; `alertName` is carried as engine-internal
 * metadata (the run transcript records which alert opened the run) and is
 * deliberately NOT rendered into the page — see {@link renderPage}.
 */
export interface AgentBrief {
  /** Rendered, human-readable incident page (the "programmatic prompt"). */
  readonly prompt: string;
  /**
   * The firing alert that opened the incident. Engine-internal metadata for the
   * run record/transcript — NOT shown to the agent (the agent reads the firing
   * alerts off Alertmanager itself).
   */
  readonly alertName: string;
  /** Endpoints + workspace + submit command, passed through verbatim. */
  readonly context: AgentContext;
}

/**
 * Renders the on-call incident PAGE the agent is paged with at t=0.
 *
 * This is NOT a context assembler: it does not collect, curate, or pre-digest
 * any incident data. It renders one neutral page — service name + reachable
 * endpoints + "the alerting stack is the source of truth, start there" — and
 * the agent self-serves everything else (reads the firing alerts off
 * Alertmanager, queries Prometheus, reads the app). The only reason this lives
 * in one place is so that single neutral page can't drift back into
 * spoon-feeding; it is pure and deterministic (same inputs → same page).
 */
export class IncidentPageRenderer {
  render(trigger: Trigger, context: AgentContext): AgentBrief {
    return {
      // The trigger is what OPENED the incident; the agent is not handed its
      // contents. It reads the live, firing alerts off the alerting stack itself
      // (the endpoints below) the way a real on-call would — see renderPage.
      prompt: renderPage(context),
      alertName: trigger.alertName,
      context,
    };
  }
}

/**
 * Renders the neutral incident page — a page, not a diagnosis.
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
function renderPage(context: AgentContext): string {
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
