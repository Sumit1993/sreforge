#!/usr/bin/env node
// =============================================================================
// lint.mjs — assert no transcript-bearing run record is committed to the PUBLIC repo.
//
// Rationale: ADR-0026 §7 draws the public/private boundary — "A file may be
// committed to the public sreforge repo iff it contains no agent transcript, no
// raw model output, and no reference-solution content. Anything transcript-bearing
// goes to sreforge-runs and is referenced from public only by full_record_sha256
// + run_url."
//
// Until now that rule was enforced on exactly one side. bank.mjs refuses to bank
// a pruned record into the private store, but nothing refused a FULL record on
// the way into this repo: `records/` is not gitignored (correctly — pruned
// records are meant to be committed), so a stray `git add -A` after a run was
// the only thing standing between a transcript and a public commit. Deleting it
// later does not help; git history is the leak.
//
// This lint closes the other side, offline and in CI. It scans git-TRACKED
// records under use-cases/ and fails if any satisfies isFullRecord() — the same
// predicate bank.mjs uses to decide what belongs in the private store.
//
// Tracked-only is deliberate: a full record sitting untracked in a working tree
// is the normal pre-banking state and must not fail anyone's local run. The
// moment it is staged or committed, it is in scope.
//
// Usage:
//   node tools/record-lint/lint.mjs [<file> ...]
// Exit 0 = clean; 1 = a full record is tracked; 2 = usage/parse error.
// =============================================================================
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isFullRecord } from "../record/is-full-record.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// Records live at use-cases/<uc>/scenarios/<scenario>/records/*.json. The glob is
// anchored at use-cases/ rather than '*/records/*.json' so an unrelated directory
// named records/ elsewhere in the tree can't quietly widen or narrow the scope.
const TRACKED_GLOB = "use-cases/**/records/*.json";

function trackedRecordFiles() {
  const out = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "-z", TRACKED_GLOB], { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function main() {
  const argv = process.argv.slice(2);
  let files;

  if (argv.length > 0) {
    files = argv.map(f => relative(REPO_ROOT, resolve(process.cwd(), f)));
  } else {
    try {
      files = trackedRecordFiles();
    } catch (err) {
      console.error(`[record-lint] FATAL: could not list tracked records via git: ${err.message}`);
      process.exit(2);
    }
  }

  const offenders = [];
  let scanned = 0;

  for (const rel of files) {
    const abs = resolve(REPO_ROOT, rel);
    let data;
    try {
      data = JSON.parse(readFileSync(abs, "utf8"));
    } catch (err) {
      console.error(`[record-lint] FATAL: ${rel}: could not parse JSON: ${err.message}`);
      process.exit(2);
    }
    scanned++;
    // Invariant (mirrors bank.mjs Safety Rail C): never echo record contents —
    // a lint that printed the offending transcript to a public CI log would leak
    // exactly what it exists to contain. Path and reason only.
    if (isFullRecord(data)) {
      offenders.push(rel);
    }
  }

  if (offenders.length > 0) {
    console.error(`[record-lint] Found ${offenders.length} transcript-bearing record(s) tracked in the public repo:`);
    for (const rel of offenders) {
      console.error(`  - ${rel}`);
    }
    console.error("");
    console.error("These carry agent transcript content and violate ADR-0026 §7.");
    console.error("Bank the full record into the private store, then commit only the pruned form:");
    console.error("  pnpm runs:bank <record.json>     # writes the full record to sreforge-runs");
    console.error("  # then replace the working copy with its pruned counterpart before committing");
    process.exit(1);
  }

  console.log(`[record-lint] Scanned ${scanned} tracked record(s). No transcript-bearing records in the public repo.`);
}

main();
