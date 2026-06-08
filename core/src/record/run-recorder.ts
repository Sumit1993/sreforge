import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunRecord } from "../types.js";
import type { RunRecorder } from "./index.js";

/** Configuration for a {@link FileRunRecorder}. */
export interface FileRunRecorderOptions {
  /** Base directory under which per-run directories are created. */
  readonly baseDir: string;
}

/**
 * Writes each run to its own directory: `<baseDir>/<runId>/`, containing:
 *   - `record.json`   — the full {@link RunRecord},
 *   - `diff.patch`    — the graded git diff (also embedded in record.json),
 *   - `transcript.txt`— the agent transcript, for verifier self-audit.
 *
 * The diff and transcript are split out as standalone files so auditors can
 * read them without parsing the JSON envelope.
 */
export class FileRunRecorder implements RunRecorder {
  readonly #baseDir: string;

  constructor(options: FileRunRecorderOptions) {
    this.#baseDir = options.baseDir;
  }

  async record(record: RunRecord): Promise<string> {
    const runDir = join(this.#baseDir, record.runId);
    await mkdir(runDir, { recursive: true });

    await Promise.all([
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
    ]);

    return runDir;
  }
}
