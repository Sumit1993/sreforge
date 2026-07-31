#!/usr/bin/env node
// bank.mjs — Content-addressed sync tool for private sreforge-runs store (ADR-0026 #28).
import { parseArgs } from "node:util";
import { readdir, readFile, writeFile, mkdir, copyFile, cp, stat } from "node:fs/promises";
import { existsSync, statSync, realpathSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

let core;
try {
  core = await import("../../core/dist/index.js");
} catch (err) {
  console.error("FATAL: Could not import core/dist/index.js. Ensure 'pnpm --dir core build' has been run.");
  process.exit(1);
}
const { serializeDiskRecord } = core;

function expandPath(pathStr) {
  if (!pathStr) return pathStr;
  if (pathStr === "~" || pathStr.startsWith("~/")) {
    const home = process.env.HOME || "/home/sumit";
    return join(home, pathStr.slice(pathStr.startsWith("~/") ? 2 : 1));
  }
  return pathStr;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

async function getDirStats(dirPath) {
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const st = await stat(fullPath);
        totalBytes += st.size;
        fileCount++;
      }
    }
  }

  await walk(dirPath);
  return { totalBytes, fileCount };
}

function isFullRecord(record) {
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
    const headerKeys = new Set(["schema_version", "run_id", "harness", "session", "confinement", "captured_at", "model", "provider", "submitted"]);
    const keys = Object.keys(at);
    if (keys.some(k => !headerKeys.has(k))) {
      return true;
    }
  }

  return false;
}

async function collectJsonFiles(targetPaths) {
  const jsonFiles = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "coverage"].includes(entry.name)) continue;
        await walk(join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        jsonFiles.push(join(current, entry.name));
      }
    }
  }

  for (const pathItem of targetPaths) {
    if (!existsSync(pathItem)) continue;
    const st = await stat(pathItem);
    if (st.isDirectory()) {
      await walk(pathItem);
    } else if (st.isFile() && pathItem.endsWith(".json")) {
      jsonFiles.push(pathItem);
    }
  }

  return jsonFiles;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      store: { type: "string" },
      "import-all": { type: "boolean", default: false },
      evidence: { type: "string", multiple: true, default: [] },
      "dry-run": { type: "boolean", default: false },
      "no-push": { type: "boolean", default: false },
    },
    strict: true,
  });

  // The store is cloned as a sibling of this repo, so derive the default from the
  // repo root rather than $HOME — that keeps the default correct wherever the
  // workspace lives. Override with --store for any other layout.
  const defaultStorePath = resolve(REPO_ROOT, "../sreforge-runs");
  const rawStorePath = values.store ? expandPath(values.store) : defaultStorePath;
  const storePath = resolve(process.cwd(), rawStorePath);

  // Safety Rail A: Refuse to run against public remote or inside public repo tree
  if (!existsSync(storePath)) {
    console.error(`FATAL: --store directory '${storePath}' does not exist.`);
    process.exit(1);
  }

  let remoteUrl = "";
  try {
    remoteUrl = execFileSync("git", ["-C", storePath, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch (err) {
    console.error(`FATAL: Could not read git remote origin URL for store at '${storePath}'.`, err.message);
    process.exit(1);
  }

  const isSreforgeRunsRemote = /^(https:\/\/github\.com\/|git@github\.com:)prismalens\/sreforge-runs(\.git)?$/.test(remoteUrl);
  if (!isSreforgeRunsRemote) {
    console.error(`FATAL: --store points at '${remoteUrl}', not sreforge-runs. Refusing to bank records into a non-private store.`);
    process.exit(1);
  }

  let realStorePath, realRepoRoot;
  try {
    realStorePath = realpathSync(storePath);
    realRepoRoot = realpathSync(REPO_ROOT);
  } catch (e) {
    // If realpath fails, fallback to resolved paths
    realStorePath = storePath;
    realRepoRoot = REPO_ROOT;
  }

  if (realStorePath === realRepoRoot || realStorePath.startsWith(realRepoRoot + "/")) {
    console.error(`FATAL: --store points at '${remoteUrl}', not sreforge-runs. Refusing to bank records into a non-private store.`);
    process.exit(1);
  }

  // Safety Rail B: Confirm private at runtime
  if (!values["dry-run"]) {
    let visibility = "";
    try {
      visibility = execFileSync("gh", ["repo", "view", "prismalens/sreforge-runs", "--json", "visibility", "-q", ".visibility"], { encoding: "utf8" }).trim();
    } catch (err) {
      console.error("FATAL: Failed to query sreforge-runs visibility via gh CLI.");
      process.exit(1);
    }
    if (visibility !== "PRIVATE") {
      console.error(`FATAL: sreforge-runs visibility is '${visibility}', expected PRIVATE. Aborting — do NOT push any record.`);
      process.exit(1);
    }
  }

  // Read existing index.json
  const indexPath = join(storePath, "index.json");
  let index = [];
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(await readFile(indexPath, "utf8"));
    } catch (err) {
      console.error(`FATAL: Failed to parse ${indexPath}:`, err.message);
      process.exit(1);
    }
  }

  let indexChanged = false;
  let wouldBankCount = 0;
  let bankedCount = 0;
  let alreadyPresentCount = 0;
  let prunedSkippedCount = 0;

  // Determine positional input targets
  let targetPaths = positionals;
  if (values["import-all"] || targetPaths.length === 0) {
    if (targetPaths.length === 0) {
      targetPaths = ["use-cases"];
    }
  }

  const jsonFiles = await collectJsonFiles(targetPaths.map(p => resolve(process.cwd(), expandPath(p))));

  for (const file of jsonFiles) {
    let rawContent = "";
    let data = null;
    try {
      rawContent = await readFile(file, "utf8");
      data = JSON.parse(rawContent);
    } catch {
      continue; // Skip non-JSON or unparseable files
    }

    if (!data || typeof data !== "object" || !data.run_id) {
      continue; // Skip files that are not run records
    }

    if (!isFullRecord(data)) {
      // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
      console.log(`[skip] ${file}: skipped: pruned (public-eligible)`);
      prunedSkippedCount++;
      continue;
    }

    const canonicalBytes = serializeDiskRecord(data);
    const computedSha = createHash("sha256").update(canonicalBytes).digest("hex");

    if (data.full_record_sha256 && data.full_record_sha256 !== computedSha) {
      console.warn(`[warn] ${file}: record full_record_sha256 '${data.full_record_sha256}' disagrees with recomputed '${computedSha}'. Using recomputed hash.`);
    }

    const recordSha = computedSha;
    const destPath = join(storePath, "records", `${recordSha}.json`);

    if (existsSync(destPath)) {
      const existing = await readFile(destPath, "utf8");
      if (existing === canonicalBytes) {
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[already-present] records/${recordSha}.json (run_id: ${data.run_id})`);
        alreadyPresentCount++;
      } else {
        console.error(`FATAL: hash collision / corrupted store entry ${recordSha}`);
        process.exit(1);
      }
    } else {
      if (values["dry-run"]) {
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[dry-run] Would bank records/${recordSha}.json (run_id: ${data.run_id}, ${canonicalBytes.length} bytes)`);
        wouldBankCount++;
      } else {
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, canonicalBytes, "utf8");
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[banked] records/${recordSha}.json (run_id: ${data.run_id})`);
        bankedCount++;
      }
    }

    if (!index.some(e => e.sha256 === recordSha)) {
      let useCase = "booklogr";
      if (data.profile?.use_case) {
        useCase = data.profile.use_case;
      } else if (file.includes("use-cases/")) {
        const parts = file.split("use-cases/")[1].split("/");
        if (parts[0]) useCase = parts[0];
      } else if (data.scenario_id && data.scenario_id.includes("/")) {
        useCase = data.scenario_id.split("/")[0];
      }

      index.push({
        run_id: data.run_id,
        use_case: useCase,
        scenario_id: data.scenario_id,
        kind: data.kind || "run-record",
        session: data.agent_transcript?.session || data.session || null,
        at: data.finished_at || data.started_at || null,
        verdict: data.verdict || null,
        score: typeof data.score?.score === "number" ? data.score.score : null,
        sha256: recordSha,
        path: `records/${recordSha}.json`,
      });
      indexChanged = true;
    }
  }

  // Evidence archiving
  let wouldBankEvidenceCount = 0;
  let bankedEvidenceCount = 0;
  let totalEvidenceBytes = 0;

  const evidenceList = Array.isArray(values.evidence) ? values.evidence : (values.evidence ? [values.evidence] : []);

  for (const evItem of evidenceList) {
    const expandedEv = expandPath(evItem);
    const resolvedEv = resolve(process.cwd(), expandedEv);

    if (!existsSync(resolvedEv)) {
      console.warn(`[warn] Evidence path '${evItem}' does not exist, skipping.`);
      continue;
    }

    const st = statSync(resolvedEv);
    const baseName = basename(resolvedEv);

    if (st.isDirectory()) {
      const destDir = join(storePath, "evidence", baseName);
      const { totalBytes, fileCount } = await getDirStats(resolvedEv);
      totalEvidenceBytes += totalBytes;

      if (values["dry-run"]) {
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[dry-run] Would bank evidence directory '${baseName}' (${formatBytes(totalBytes)}, ${fileCount} files)`);
        wouldBankEvidenceCount++;
      } else {
        await mkdir(dirname(destDir), { recursive: true });
        await cp(resolvedEv, destDir, { recursive: true });
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[banked] evidence directory '${baseName}'`);
        bankedEvidenceCount++;
      }

      const indexPathRel = `evidence/${baseName}`;
      if (!index.some(e => e.path === indexPathRel)) {
        index.push({
          kind: "evidence",
          path: indexPathRel,
          at: st.mtime.toISOString(),
          use_case: "booklogr",
          note: `Raw evidence directory archived from ${evItem}`,
        });
        indexChanged = true;
      }
    } else if (st.isFile()) {
      const destFile = join(storePath, "evidence", baseName);
      totalEvidenceBytes += st.size;

      if (values["dry-run"]) {
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[dry-run] Would bank evidence file '${baseName}' (${formatBytes(st.size)})`);
        wouldBankEvidenceCount++;
      } else {
        await mkdir(dirname(destFile), { recursive: true });
        await copyFile(resolvedEv, destFile);
        // Invariant (Safety Rail C): Never log record/transcript/evidence contents, only metadata/hashes
        console.log(`[banked] evidence file '${baseName}'`);
        bankedEvidenceCount++;
      }

      const indexPathRel = `evidence/${baseName}`;
      if (!index.some(e => e.path === indexPathRel)) {
        index.push({
          kind: "evidence",
          path: indexPathRel,
          at: st.mtime.toISOString(),
          use_case: "booklogr",
          note: `Raw evidence file archived from ${evItem}`,
        });
        indexChanged = true;
      }
    }
  }

  // Update index.json if changed and not dry run
  if (indexChanged && !values["dry-run"]) {
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  }

  // Commit and Push if changes were made
  if (!values["dry-run"] && (bankedCount > 0 || bankedEvidenceCount > 0 || indexChanged)) {
    const gitStatus = execFileSync("git", ["-C", storePath, "status", "--porcelain", "--", "records", "evidence", "index.json"], { encoding: "utf8" }).trim();
    if (gitStatus.length > 0) {
      execFileSync("git", ["-C", storePath, "add", "--", "records", "evidence", "index.json"]);
      execFileSync("git", ["-C", storePath, "commit", "-m", "chore(record): bank full records and evidence"]);
      if (!values["no-push"]) {
        execFileSync("git", ["-C", storePath, "push"]);
      }
    }
  }

  // Summary output
  if (values["dry-run"]) {
    console.log(`\nDry-run complete: ${wouldBankCount} full records; ${prunedSkippedCount} pruned skipped; ${wouldBankEvidenceCount} evidence item(s) (${formatBytes(totalEvidenceBytes)})`);
  } else {
    console.log(`\nBanking complete: ${bankedCount} full records banked, ${alreadyPresentCount} already present, ${prunedSkippedCount} pruned skipped, ${bankedEvidenceCount} evidence items archived.`);
  }
}

await main();
