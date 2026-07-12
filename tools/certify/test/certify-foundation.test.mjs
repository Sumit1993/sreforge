// certify-foundation.test.mjs — ADR-0026 §1/§2/§6 foundation.
// Run: node --test tools/certify/test/  (or `npm test` if wired).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../validate-manifest.mjs";
import {
  computeSurfaceHashes,
  compareAgainstManifest,
  HASH_ALGO,
} from "../surface-hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => JSON.parse(readFileSync(resolve(HERE, "..", p), "utf8"));

const SCENARIO = { useCase: "booklogr", stack: "flask-compose", scenario: "db-pool-exhaustion-deploy" };
const SHA256 = /^[a-f0-9]{64}$/;

// ── #27: sample manifests validate cleanly against their schemas ──────────────
test("scenario-certification example validates", () => {
  assert.deepEqual(validateManifest(load("examples/scenario-certification.example.json")), []);
});

test("substrate-intake example validates", () => {
  assert.deepEqual(validateManifest(load("examples/substrate-intake.example.json")), []);
});

test("a manifest missing a required field is rejected", () => {
  const m = load("examples/scenario-certification.example.json");
  delete m.records;
  const errs = validateManifest(m);
  assert.ok(errs.some((e) => /records/.test(e)), `expected a 'records' error, got: ${errs}`);
});

test("wrong tier const is rejected", () => {
  const m = load("examples/scenario-certification.example.json");
  m.tier = "self-certified";
  assert.ok(validateManifest(m).some((e) => /tier/.test(e)));
});

test("a bad sha256 in hashes is rejected", () => {
  const m = load("examples/scenario-certification.example.json");
  m.hashes.own_hash = "not-a-hash";
  assert.ok(validateManifest(m).some((e) => /own_hash/.test(e)));
});

test("≥1 graded record is required (ADR §3): only positive-smoke is rejected", () => {
  const m = load("examples/scenario-certification.example.json");
  m.records = [{ ...m.records[0], kind: "positive-smoke" }];
  assert.ok(validateManifest(m).some((e) => /contains/.test(e)), "expected a 'contains' error");
});

test("a record missing run_url is rejected (ADR §7)", () => {
  const m = load("examples/scenario-certification.example.json");
  delete m.records[0].run_url;
  assert.ok(validateManifest(m).some((e) => /run_url/.test(e)));
});

test("determinism thresholds are enforced (ADR §5): <2 cold arms rejected", () => {
  const m = load("examples/scenario-certification.example.json");
  m.checklist.determinism.cold_arms = 1;
  assert.ok(validateManifest(m).some((e) => /cold_arms/.test(e)));
});

// ── #26: hashing is deterministic and structurally sound ──────────────────────
test("surface hashes are deterministic across runs on the same inputs", () => {
  const a = computeSurfaceHashes(SCENARIO);
  const b = computeSurfaceHashes(SCENARIO);
  assert.equal(a.algorithm, HASH_ALGO);
  assert.match(a.own_hash, SHA256);
  assert.match(a.shared_hash, SHA256);
  assert.equal(a.own_hash, b.own_hash);
  assert.equal(a.shared_hash, b.shared_hash);
  assert.notEqual(a.own_hash, a.shared_hash);
  assert.ok(a.own_files.length > 0 && a.shared_files.length > 0);
  // The manifest itself must never be part of its own surface (no self-reference).
  assert.ok(!a.own_files.some((f) => f.endsWith("verify/acceptance.json")));
  // ADR §2: the storm script is scenario-owned.
  assert.ok(a.own_files.some((f) => f.endsWith("load/booklogr-storm-mixed.js")), "storm script must be in own surface");
  // The shared-surface list file is itself hashed (list edits move shared_hash).
  assert.ok(a.shared_files.some((f) => f.endsWith("verify/shared-surface.json")));
});

test("algorithm drift forces full-recert", () => {
  const now = computeSurfaceHashes(SCENARIO);
  const manifest = {
    surface: { own_additions: [], shared_additions: [] },
    hashes: { algorithm: "sha256-OLD-v0", own_hash: now.own_hash, shared_hash: now.shared_hash },
  };
  assert.equal(compareAgainstManifest(manifest, SCENARIO).action, "full-recert");
});

test("a surface path escaping the stack fails loud", () => {
  assert.throws(
    () => computeSurfaceHashes({ ...SCENARIO, sharedAdditions: ["../../../../etc/hostname"] }),
    /escapes/,
  );
});

// ── #26: compare-vs-manifest picks the right action per ADR §2 ────────────────
test("compareAgainstManifest: up-to-date / addendum / full-recert", () => {
  const now = computeSurfaceHashes(SCENARIO);
  const manifest = {
    surface: { own_additions: [], shared_additions: [] },
    hashes: { algorithm: now.algorithm, own_hash: now.own_hash, shared_hash: now.shared_hash },
  };

  assert.equal(compareAgainstManifest(manifest, SCENARIO).action, "up-to-date");

  const sharedMoved = { ...manifest, hashes: { ...manifest.hashes, shared_hash: "0".repeat(64) } };
  assert.equal(compareAgainstManifest(sharedMoved, SCENARIO).action, "shared-smoke-addendum");

  // own mismatch dominates even if shared also differs
  const ownMoved = { ...manifest, hashes: { own_hash: "0".repeat(64), shared_hash: "0".repeat(64) } };
  assert.equal(compareAgainstManifest(ownMoved, SCENARIO).action, "full-recert");
});

test("a declared surface path that does not exist fails loud", () => {
  assert.throws(
    () => computeSurfaceHashes({ ...SCENARIO, sharedAdditions: ["scripts/does-not-exist.sh"] }),
    /does not exist/,
  );
});
