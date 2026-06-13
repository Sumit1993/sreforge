import type { DeployResult } from "../types.js";
import type { CdDeployer } from "./index.js";
import { run } from "./process.js";

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 300_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Configuration for {@link ComposeCdDeployer}. */
export interface ComposeCdDeployerOptions {
  /** Path to the docker-compose file for the deployment. */
  readonly composeFile: string;
  /** Optional compose project name (`-p`). */
  readonly projectName?: string;
  /** Poll interval while waiting for the service to report healthy. */
  readonly pollIntervalMs?: number;
  /** Max time to wait for build + healthy before failing the redeploy. */
  readonly timeoutMs?: number;
}

/**
 * CD-on-merge: rebuilds the affected service's image from the compose build
 * context and swaps the container, then waits for it to report healthy.
 *
 * The build context (set in the compose file) is the run workspace tree, which
 * already holds the merged fix at this point — so the redeploy deploys exactly
 * the graded code without depending on the forge's branch topology. Runs only
 * after the CI gate is green and the fix is merged. The agent never deploys.
 */
export class ComposeCdDeployer implements CdDeployer {
  readonly #composeFile: string;
  readonly #projectName: string | undefined;
  readonly #pollMs: number;
  readonly #timeoutMs: number;

  constructor(options: ComposeCdDeployerOptions) {
    this.#composeFile = options.composeFile;
    this.#projectName = options.projectName;
    this.#pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async redeploy(service: string): Promise<DeployResult> {
    const startedAt = Date.now();

    const up = await run(
      "docker",
      [...this.#composeArgs(), "up", "-d", "--build", service],
      { timeoutMs: this.#timeoutMs },
    );
    if (up.code !== 0) {
      return { redeployed: false, service, durationMs: Date.now() - startedAt };
    }

    // Give health-polling its own budget measured from AFTER the build, so a
    // slow `up --build` can't exhaust the deadline before polling even starts.
    const healthDeadline =
      Date.now() + Math.max(30_000, this.#timeoutMs - (Date.now() - startedAt));
    const healthy = await this.#waitHealthy(service, healthDeadline);
    return { redeployed: healthy, service, durationMs: Date.now() - startedAt };
  }

  #composeArgs(): string[] {
    const base = ["compose"];
    if (this.#projectName) base.push("-p", this.#projectName);
    base.push("-f", this.#composeFile);
    return base;
  }

  /** Polls `docker compose ps` until the service is healthy (or running, if it
   *  declares no healthcheck), or the deadline passes. */
  async #waitHealthy(service: string, deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      const ps = await run("docker", [
        ...this.#composeArgs(),
        "ps",
        "--format",
        "json",
        service,
      ]);
      const state = parseServiceState(ps.stdout);
      if (state.health === "healthy") return true;
      if (state.health === null && state.running) return true;
      if (state.health === "unhealthy") return false;
      await sleep(this.#pollMs);
    }
    return false;
  }
}

interface ServiceState {
  readonly running: boolean;
  /** "healthy" | "unhealthy" | "starting" | null (no healthcheck declared). */
  readonly health: string | null;
}

/**
 * Parses `docker compose ps --format json` output, which is either a JSON array
 * or newline-delimited JSON objects depending on the compose version.
 */
function parseServiceState(stdout: string): ServiceState {
  const text = stdout.trim();
  if (!text) return { running: false, health: null };

  let entries: Array<Record<string, unknown>> = [];
  try {
    const parsed: unknown = JSON.parse(text);
    entries = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [parsed as Record<string, unknown>];
  } catch {
    entries = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  }

  const entry = entries[0];
  if (!entry) return { running: false, health: null };

  const state = typeof entry.State === "string" ? entry.State : "";
  const healthRaw = typeof entry.Health === "string" ? entry.Health : "";
  return {
    running: state === "running",
    health: healthRaw === "" ? null : healthRaw,
  };
}
