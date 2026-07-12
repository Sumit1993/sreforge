#!/usr/bin/env node
// =============================================================================
// validate-manifest.mjs — ADR-0026 §1/§6: validate a certification manifest
// against its versioned JSON Schema. Dependency-free (json-schema-mini), so the
// required CI check (#33) and `pnpm forge certify` (#34) share one validator.
//
// The schema is selected by the manifest's `kind` + `manifest_version` major.
//
// Usage:
//   node tools/certify/validate-manifest.mjs <manifest.json> [<manifest.json> …]
// Exit 0 = all valid; 1 = a validation error; 2 = usage/parse error.
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema-mini.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const SCHEMA_BY_KIND = {
  "scenario-certification": "scenario-certification",
  "substrate-intake": "substrate-intake",
};

/** Load the schema for a manifest kind + major version. */
export function schemaFor(kind, manifestVersion) {
  const base = SCHEMA_BY_KIND[kind];
  if (!base) throw new Error(`unknown manifest kind "${kind}"`);
  const major = String(manifestVersion || "1").split(".")[0];
  const path = resolve(HERE, "schemas", `${base}.v${major}.schema.json`);
  if (!existsSync(path)) throw new Error(`no schema for ${kind} v${major} (${path})`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Validate one parsed manifest object → array of error strings ([] = valid). */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (!manifest.kind) return ['manifest missing "kind"'];
  let schema;
  try {
    schema = schemaFor(manifest.kind, manifest.manifest_version);
  } catch (e) {
    return [e.message]; // preserve the documented array-return contract
  }
  return validate(schema, manifest);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: validate-manifest.mjs <manifest.json> [<manifest.json> …]");
    process.exit(2);
  }
  let bad = 0;
  for (const f of files) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(f), "utf8"));
    } catch (e) {
      console.error(`✗ ${f}: cannot read/parse (${e.message})`);
      bad++;
      continue;
    }
    let errs;
    try {
      errs = validateManifest(manifest);
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
      bad++;
      continue;
    }
    if (errs.length) {
      console.error(`✗ ${f}: ${errs.length} error(s)`);
      for (const e of errs) console.error(`    - ${e}`);
      bad++;
    } else {
      console.log(`✓ ${f}: valid ${manifest.kind} v${manifest.manifest_version}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
