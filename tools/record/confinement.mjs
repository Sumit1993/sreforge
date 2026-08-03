// =============================================================================
// confinement.mjs — the confinement tier enum (#123), shared by the two ends of
// the handoff.
//
// `agent_transcript.confinement` records the tier the agent actually ran under.
// It is the field that decides whether a verdict is quotable, so two places
// must agree on what a valid value looks like:
//   - tools/transcript/write-handoff.mjs — the WRITE end; refuses to emit a
//     handoff whose --confinement is missing or outside the enum.
//   - tools/record/bank.mjs              — the BANK end (#124); refuses to bank
//     a new full record whose header is missing or outside the enum.
//
// write-handoff.mjs is a CLI script (it runs `run()` on import), so it cannot be
// imported for its constant. The enum therefore lives here, and
// tools/record/test/confinement-tiers-crosscheck.test.mjs pins this list against
// write-handoff.mjs's validation guard by parsing that file's source — the same
// pattern header-keys-crosscheck.test.mjs uses for is-full-record.mjs.
// =============================================================================

// Keep the declaration below as a single-line `confinementTiers` Set literal of
// quoted strings — the crosscheck test parses it out of this file's source with
// a regex that takes the FIRST match in the file. Do not restate that exact
// source form anywhere above it (a comment echoing the literal syntax would
// shadow the real declaration and silently break the crosscheck).
const confinementTiers = new Set(["host-open", "host-sandboxed", "in-box"]);

export const CONFINEMENT_TIERS = confinementTiers;

/** True when `value` is one of the three recognised confinement tiers. */
export function isValidConfinement(value) {
  return typeof value === "string" && confinementTiers.has(value);
}
