// =============================================================================
// is-full-record.mjs — the public/private boundary predicate (ADR-0026 §7).
//
// A record is "full" if it carries agent transcript content. Full records are
// contamination-bearing (transcripts, and through them reference-solution
// content) and belong ONLY in the private sreforge-runs store. A "pruned"
// record — metadata, verdict, timings, plus a `full_record_sha256` pointer at
// its full counterpart — is public-eligible and is what gets committed here.
//
// This predicate has two consumers that must never disagree:
//   - tools/record/bank.mjs   — skips pruned records when banking
//   - tools/record-lint/lint.mjs — fails CI if a full record is committed here
//
// They are the two halves of one boundary. If bank.mjs called something "full"
// that the lint called "pruned", a transcript-bearing record would be refused
// by the store AND waved through into the public repo — the exact inversion of
// the rule. One definition, imported by both, is the only way that stays true.
// =============================================================================

// Keep the declaration below as a single-line `headerKeys` Set literal of quoted
// strings — the crosscheck test in tools/record/test/header-keys-crosscheck.test.mjs
// parses it out of this file's source with a regex and compares it against
// pruneDiskRecord()'s key list in core/src/record/serialize.ts. The two must stay
// identical: a key that serialize.ts preserves when pruning but this set omits
// would make every pruned record look full, and vice versa.
//
// Do not restate that declaration's exact source form anywhere above it in this
// file — the test's regex takes the first match in the file, so a comment echoing
// the literal syntax shadows the real declaration and the crosscheck breaks.
const headerKeys = new Set(["schema_version", "run_id", "harness", "session", "confinement", "captured_at", "model", "provider", "submitted"]);

export const HEADER_KEYS = headerKeys;

export function isFullRecord(record) {
  if (typeof record !== "object" || record === null) return false;

  // 1. Check trajectory.transcript
  if (typeof record.trajectory?.transcript === "string" && record.trajectory.transcript.trim() !== "") {
    return true;
  }

  // 2. Check agent_transcript payload
  if (record.agent_transcript && typeof record.agent_transcript === "object") {
    const at = record.agent_transcript;
    if (typeof at.raw_text === "string" || typeof at.raw_json === "string" || at.raw_json || at.events || at.transcript || at.trajectory) {
      return true;
    }
    const keys = Object.keys(at);
    if (keys.some(k => !headerKeys.has(k))) {
      return true;
    }
  }

  return false;
}
