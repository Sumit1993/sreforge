import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

import type { RunRecord } from "../types.js";
import type { RunRecorder } from "./index.js";

/** Configuration for a {@link FileRunRecorder}. */
export interface FileRunRecorderOptions {
  /** Base directory under which per-run directories are created. */
  readonly baseDir: string;
  /** Optional path to the raw transcript handoff from the agent harness. */
  readonly transcriptHandoffPath?: string;
}

/**
 * Writes each run to its own directory: `<baseDir>/<runId>/`, containing:
 *   - `record.json`   — the full {@link RunRecord},
 *   - `diff.patch`    — the graded git diff (also embedded in record.json),
 *   - `transcript.txt`— the engine runner's own event log (NOT the agent transcript),
 *   - `agent-transcript.json` — the raw agent output, if captured.
 *
 * The diff and transcript logs are split out as standalone files so auditors can
 * read them without parsing the JSON envelope.
 */
export class FileRunRecorder implements RunRecorder {
  readonly #baseDir: string;
  readonly #handoffPath?: string;

  constructor(options: FileRunRecorderOptions) {
    this.#baseDir = options.baseDir;
    this.#handoffPath = options.transcriptHandoffPath;
  }

  async record(record: RunRecord): Promise<string> {
    const runDir = join(this.#baseDir, record.runId);
    await mkdir(runDir, { recursive: true });

    const writes = [
      writeFile(
        join(runDir, "record.json"),
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8",
      ),
      writeFile(join(runDir, "diff.patch"), record.diff, "utf8"),
      writeFile(
        join(runDir, "transcript.txt"),
        record.trajectory.transcript,
        "utf8",
      ),
    ];

    if (this.#handoffPath && existsSync(this.#handoffPath)) {
      try {
        const content = await readFile(this.#handoffPath, "utf8");
        const handoff = JSON.parse(content);
        if (handoff.run_id === record.runId) {
          writes.push(writeFile(join(runDir, "agent-transcript.json"), content, "utf8"));
        } else {
          const err = `Transcript mismatch: handoff file run_id '${handoff.run_id}' != record runId '${record.runId}'`;
          console.error(`ERROR: ${err}`);
          writes.push(writeFile(join(runDir, "transcript-error.txt"), err + "\n", "utf8"));
        }
      } catch (err: unknown) {
        console.warn(`WARNING: Failed to read or parse transcript handoff at ${this.#handoffPath}:`, err instanceof Error ? err.message : err);
      }
    }

    await Promise.all(writes);

    return runDir;
  }
}
