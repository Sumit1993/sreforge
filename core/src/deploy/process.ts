import { execFile } from "node:child_process";

/** Result of running an external command. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Process exit code; non-zero (or spawn failure) means failure. */
  readonly code: number;
}

/** Options for {@link run}. */
export interface RunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Extra environment entries merged over `process.env`. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Runs an external command and resolves with its captured output and exit code.
 *
 * Never rejects on a non-zero exit — the caller inspects `code`. It only models
 * the cases the deploy/cleanup steps need (git, docker compose), with a large
 * stdout buffer for build logs. `execFile` (no shell) avoids shell-injection.
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
  });
}
