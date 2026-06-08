import type { RunRecord } from "../types.js";

/**
 * Persists a {@link RunRecord} to a run directory on disk, enabling verifier
 * self-audit and the leaderboard. Returns the directory it wrote to.
 */
export interface RunRecorder {
  record(record: RunRecord): Promise<string>;
}

export { FileRunRecorder } from "./run-recorder.js";
export type { FileRunRecorderOptions } from "./run-recorder.js";
