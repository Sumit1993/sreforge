import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

export function extractKeysFromSerialize(text) {
  const match = text.match(/const\s+keys\s*=\s*\[([^\]]+)\]/);
  if (!match) throw new Error("Could not find 'const keys = [...]' in serialize.ts");
  const keyMatches = match[1].match(/"([^"]+)"/g);
  if (!keyMatches) throw new Error("No keys found in serialize.ts keys array");
  return new Set(keyMatches.map(k => k.replace(/"/g, "")));
}

export function extractKeysFromBank(text) {
  const match = text.match(/const\s+headerKeys\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
  if (!match) throw new Error("Could not find 'const headerKeys = new Set([...])' in bank.mjs");
  const keyMatches = match[1].match(/"([^"]+)"/g);
  if (!keyMatches) throw new Error("No keys found in bank.mjs headerKeys array");
  return new Set(keyMatches.map(k => k.replace(/"/g, "")));
}

test("header keys list cross-check: serialize.ts and bank.mjs match exactly", () => {
  const serializePath = join(REPO_ROOT, "core/src/record/serialize.ts");
  const bankPath = join(REPO_ROOT, "tools/record/bank.mjs");

  const serializeContent = readFileSync(serializePath, "utf8");
  const bankContent = readFileSync(bankPath, "utf8");

  const serializeKeys = extractKeysFromSerialize(serializeContent);
  const bankKeys = extractKeysFromBank(bankContent);

  assert.deepEqual(
    Array.from(serializeKeys).sort(),
    Array.from(bankKeys).sort(),
    `Prune header keys mismatch between ${serializePath} and ${bankPath}`
  );
});
