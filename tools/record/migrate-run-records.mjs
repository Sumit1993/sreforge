#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));

let core;
try {
  core = await import("../../core/dist/index.js");
} catch (err) {
  console.error("FATAL: Could not import core/dist/index.js. Ensure 'pnpm --dir core build' has been run.");
  process.exit(1);
}
const { toDiskRecord, serializeDiskRecord } = core;

let validate;
try {
  const lib = await import("../certify/lib/json-schema-mini.mjs");
  validate = lib.validate;
} catch (err) {
  console.error("FATAL: Could not import json-schema-mini.mjs.", err);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "runs-dir": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

if (!values["runs-dir"]) {
  console.error("Usage: migrate-run-records.mjs --runs-dir <path> [--dry-run]");
  process.exit(1);
}

const runsDir = values["runs-dir"];
const dryRun = values["dry-run"];

const schemaPath = join(HERE, "../certify/schemas/run-record.v1.schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));

async function main() {
  const dirs = await readdir(runsDir, { withFileTypes: true });
  let migrated = 0;
  let skipped = 0;
  let schemaValid = 0;
  
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const recordPath = join(runsDir, dir.name, "record.json");
    if (!existsSync(recordPath)) continue;

    const raw = await readFile(recordPath, "utf8");
    const data = JSON.parse(raw);

    if (data.run_id) {
      console.log(`[skip] ${dir.name} is already migrated.`);
      skipped++;
      const errors = validate(schema, data);
      if (errors.length > 0) {
        console.error(`FATAL: Pre-existing record ${dir.name} failed schema validation.`);
        console.error(errors);
        process.exit(1);
      }
      schemaValid++;
      continue;
    }

    if (!data.runId) {
      console.warn(`[warn] ${dir.name} missing runId, skipping.`);
      skipped++;
      continue;
    }

    let agentTranscript;
    const handoffPath = join(runsDir, dir.name, "agent-transcript.json");
    if (existsSync(handoffPath)) {
      try {
        agentTranscript = JSON.parse(await readFile(handoffPath, "utf8"));
      } catch (e) {
        console.warn(`[warn] Failed to parse ${handoffPath}: ${e.message}`);
      }
    }

    const diskRecord = toDiskRecord(data, agentTranscript);
    const outBytes = serializeDiskRecord(diskRecord);

    const errors = validate(schema, diskRecord);
    if (errors.length > 0) {
      console.error(`FATAL: Migrated record ${dir.name} failed schema validation.`);
      console.error(errors);
      process.exit(1);
    }
    schemaValid++;

    if (dryRun) {
      console.log(`[dry-run] Would migrate ${dir.name}`);
    } else {
      const tempPath = `${recordPath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, outBytes, "utf8");
      await rename(tempPath, recordPath);
      console.log(`[migrated] ${dir.name}`);
    }
    migrated++;
  }
  
  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped.`);
  console.log(`Schema valid count: ${schemaValid}`);
}

await main();
