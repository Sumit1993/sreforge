// Pins the confinement enum in tools/record/confinement.mjs (which bank.mjs
// imports, #124) against the validation guard in tools/transcript/write-handoff.mjs
// (the write end, #123). write-handoff.mjs is a CLI script that runs on import,
// so the constant cannot be shared by import; this is the same source-text
// crosscheck header-keys-crosscheck.test.mjs uses for is-full-record.mjs.
//
// Both regexes take the FIRST match in their file — see the "do not restate the
// declaration above it" comments in the two files being parsed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

export function extractTiersFromWriteHandoff(text) {
  const match = text.match(
    /if\s*\((values\.confinement\s*!==\s*"[^"]*"(?:\s*&&\s*values\.confinement\s*!==\s*"[^"]*")*)\)/
  );
  if (!match) throw new Error("Could not find the confinement validation guard in write-handoff.mjs");
  const tierMatches = match[1].match(/"([^"]*)"/g);
  if (!tierMatches) throw new Error("No tiers found in write-handoff.mjs confinement guard");
  return new Set(tierMatches.map(t => t.replace(/"/g, "")));
}

export function extractTiersFromModule(text) {
  const match = text.match(/const\s+confinementTiers\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
  if (!match) throw new Error("Could not find 'const confinementTiers = new Set([...])' in confinement.mjs");
  const tierMatches = match[1].match(/"([^"]+)"/g);
  if (!tierMatches) throw new Error("No tiers found in confinement.mjs confinementTiers set");
  return new Set(tierMatches.map(t => t.replace(/"/g, "")));
}

test("confinement tiers cross-check: write-handoff.mjs and confinement.mjs match exactly", () => {
  const handoffPath = join(REPO_ROOT, "tools/transcript/write-handoff.mjs");
  const modulePath = join(REPO_ROOT, "tools/record/confinement.mjs");

  const handoffTiers = extractTiersFromWriteHandoff(readFileSync(handoffPath, "utf8"));
  const moduleTiers = extractTiersFromModule(readFileSync(modulePath, "utf8"));

  assert.deepEqual(
    Array.from(handoffTiers).sort(),
    Array.from(moduleTiers).sort(),
    `Confinement tier mismatch between ${handoffPath} and ${modulePath}`
  );
});

test("confinement tiers cross-check: the parsed set is the live exported set", async () => {
  const { CONFINEMENT_TIERS } = await import("../confinement.mjs");
  const modulePath = join(REPO_ROOT, "tools/record/confinement.mjs");
  const parsed = extractTiersFromModule(readFileSync(modulePath, "utf8"));

  assert.deepEqual(
    Array.from(CONFINEMENT_TIERS).sort(),
    Array.from(parsed).sort(),
    "the regex must parse the declaration the module actually exports, not a shadowing echo of it"
  );
});
