#!/usr/bin/env node
// =============================================================================
// surface-hash.mjs — ADR-0026 §2/§6: the ONE shared hashing script.
//
// Computes the two content hashes a scenario-certification manifest is tied to:
//
//   own_hash    — over the scenario-OWNED surface (the scenario content dir +
//                 its stack scenario.env + any per-scenario `own_additions`).
//                 A mismatch means the scenario itself changed ⇒ FULL
//                 re-certification.
//   shared_hash — over the GLOBAL-DEFAULT shared surface for the stack
//                 (fault-delivery / arm libs, compose, alert rules; declared in
//                 <stack>/verify/shared-surface.json), plus any per-scenario
//                 `shared_additions`. A mismatch means only plumbing moved ⇒
//                 append a fresh positive-smoke record as an addendum (no full
//                 re-certification).
//
// Consumed by BOTH `pnpm forge certify` (#34) and the required CI check (#33) —
// there is exactly one implementation of the hash so the two can never drift.
// Dependency-free (node:crypto) so it runs in CI with no install.
//
// Algorithm (stable, versioned = HASH_ALGO): for every file in a surface,
// take sha256(bytes); build lines `<repo-relative-path>\0<filehash>`; sort by
// path (byte order); join with "\n"; sha256 that. Content- and path-based, so
// it is invariant to filesystem order and mtimes but sensitive to any content,
// rename, add, or delete. A declared path that does not exist is a hard error
// (a manifest tied to a missing file is a build bug, not a soft pass).
//
// Usage:
//   node tools/certify/surface-hash.mjs \
//     --use-case booklogr --stack flask-compose --scenario db-pool-exhaustion-deploy
//        → prints { own_hash, shared_hash, own_files, shared_files }
//
//   node tools/certify/surface-hash.mjs … --manifest <acceptance.json>
//        → compare mode: recompute vs the manifest's stored hashes + additions,
//          print { own:{…}, shared:{…}, action } where action ∈
//          up-to-date | shared-smoke-addendum | full-recert
// =============================================================================
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HASH_ALGO = "sha256-sorted-file-digests-v1";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");

/** sha256 hex of a file's bytes. */
function digestFile(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Recursively list files under a path (file → [file]; dir → all files).
 *  `skip(rel)` drops matches (rel is repo-relative). Order-independent. */
function listFiles(abs, skip = () => false) {
  const rel = relative(REPO_ROOT, abs);
  if (!existsSync(abs)) throw new Error(`surface path does not exist: ${rel}`);
  const st = statSync(abs);
  if (st.isFile()) return skip(rel) ? [] : [abs];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === ".DS_Store") continue;
    out.push(...listFiles(join(abs, name), skip));
  }
  return out;
}

/** Hash a set of absolute file paths into one surface hash + the sorted
 *  repo-relative file list that produced it. */
function hashSurface(absFiles) {
  const rows = absFiles
    .map((abs) => [relative(REPO_ROOT, abs), digestFile(abs)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hash = createHash("sha256")
    .update(rows.map(([p, h]) => `${p}\0${h}`).join("\n"))
    .digest("hex");
  return { hash, files: rows.map(([p]) => p) };
}

function stackDir(useCase, stack) {
  return resolve(REPO_ROOT, "use-cases", useCase, "stacks", stack);
}

/** Resolve a declared (stack-relative) surface path and assert it stays inside
 *  `base` — a `../..` escape would both be a traversal and tie the hash to an
 *  absolute machine path (breaking cross-machine determinism). */
function resolveWithin(base, p, label) {
  const abs = resolve(base, p);
  const rel = relative(base, abs);
  if (rel === "" || rel.startsWith("..")) {
    throw new Error(`${label} path escapes ${relative(REPO_ROOT, base) || "."}: ${p}`);
  }
  return abs;
}

/** Read a single KEY=value from a scenario.env (quotes + trailing comment stripped). */
function readEnvVar(envPath, key) {
  const m = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
}

/** Owned surface (ADR-0026 §2): scenario content dir (minus its own manifest) +
 *  its stack scenario.env + its storm script + declared own_additions. */
export function collectOwnFiles({ useCase, stack, scenario, ownAdditions = [] }) {
  const sd = stackDir(useCase, stack);
  const scenarioDir = resolve(REPO_ROOT, "use-cases", useCase, "scenarios", scenario);
  const manifestRel = relative(REPO_ROOT, join(scenarioDir, "verify", "acceptance.json"));
  const files = listFiles(scenarioDir, (rel) => rel === manifestRel);

  const scenarioEnv = resolve(sd, "scenarios", scenario, "scenario.env");
  files.push(...listFiles(scenarioEnv)); // fail loud (consistent with every other path) if absent

  // The storm script shapes the fault's load dynamics — scenario-owned per §2.
  const storm = readEnvVar(scenarioEnv, "STORM_SCRIPT");
  if (storm) files.push(...listFiles(resolveWithin(sd, join("load", storm), "STORM_SCRIPT")));

  for (const p of ownAdditions) files.push(...listFiles(resolveWithin(sd, p, "own_additions")));
  return files;
}

/** Shared surface (ADR-0026 §2): the stack's global-default list + declared
 *  shared_additions (all stack-relative). The list file itself is hashed too,
 *  so edits to WHICH paths are shared move the shared_hash. */
export function collectSharedFiles({ useCase, stack, sharedAdditions = [] }) {
  const sd = stackDir(useCase, stack);
  const cfgPath = resolve(sd, "verify", "shared-surface.json");
  if (!existsSync(cfgPath)) {
    throw new Error(
      `no shared-surface.json at ${relative(REPO_ROOT, cfgPath)} — the stack ` +
        `must declare its global-default shared surface (ADR-0026 §2)`,
    );
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const paths = [...(cfg.paths || []), ...sharedAdditions];
  const files = [cfgPath];
  for (const p of paths) files.push(...listFiles(resolveWithin(sd, p, "shared surface")));
  return files;
}

export function computeSurfaceHashes(opts) {
  const own = hashSurface(collectOwnFiles(opts));
  const shared = hashSurface(collectSharedFiles(opts));
  return {
    algorithm: HASH_ALGO,
    own_hash: own.hash,
    shared_hash: shared.hash,
    own_files: own.files,
    shared_files: shared.files,
  };
}

/** Decide the certification action implied by a manifest vs the current tree
 *  (ADR-0026 §2): own mismatch ⇒ full-recert; else shared mismatch ⇒
 *  shared-smoke-addendum; else up-to-date. */
export function compareAgainstManifest(manifest, { useCase, stack, scenario }) {
  const additions = manifest.surface || {};
  const now = computeSurfaceHashes({
    useCase,
    stack,
    scenario,
    ownAdditions: additions.own_additions || [],
    sharedAdditions: additions.shared_additions || [],
  });
  const stored = manifest.hashes || {};
  const own = { expected: stored.own_hash, actual: now.own_hash };
  const shared = { expected: stored.shared_hash, actual: now.shared_hash };
  own.match = own.expected === own.actual;
  shared.match = shared.expected === shared.actual;
  // Algorithm drift means the stored hashes aren't comparable — treat as a full
  // re-cert rather than a spurious "up-to-date".
  const algorithmMatch = !stored.algorithm || stored.algorithm === now.algorithm;
  const action = !algorithmMatch || !own.match
    ? "full-recert"
    : !shared.match
      ? "shared-smoke-addendum"
      : "up-to-date";
  return { algorithm: { expected: stored.algorithm, actual: now.algorithm, match: algorithmMatch }, own, shared, action };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) a[k.slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const missing = ["use-case", "stack", "scenario"].filter((k) => !a[k]);
  if (missing.length) {
    console.error(
      `usage: surface-hash.mjs --use-case <uc> --stack <stack> --scenario <id> [--manifest <acceptance.json>]\n` +
        `missing: ${missing.join(", ")}`,
    );
    process.exit(2);
  }
  const opts = { useCase: a["use-case"], stack: a.stack, scenario: a.scenario };
  try {
    if (a.manifest) {
      const manifest = JSON.parse(readFileSync(resolve(a.manifest), "utf8"));
      const res = compareAgainstManifest(manifest, opts);
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.action === "full-recert" ? 3 : 0);
    } else {
      console.log(JSON.stringify(computeSurfaceHashes(opts), null, 2));
    }
  } catch (e) {
    console.error(`surface-hash: ${e.message}`);
    process.exit(1);
  }
}
