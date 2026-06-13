import { ContextAssembler } from "./context/index.js";
import type { AutoMerge, CdDeployer, CiGate } from "./deploy/index.js";
import type { AgentRunner } from "./runner/index.js";
import { NoopAgentRunner } from "./runner/index.js";
import type { TriggerSource } from "./triggers/index.js";
import type { Cleanup } from "./cleanup/index.js";
import type { RunRecorder } from "./record/index.js";
import type { Oracle, OracleContext } from "./verify/index.js";
import type {
  CiResult,
  DeployResult,
  OracleScore,
  PhaseTimings,
  RunPhase,
  RunRecord,
  SreforgeConfig,
  Trajectory,
  Trigger,
  Verdict,
} from "./types.js";

/**
 * The collaborators the {@link Conductor} sequences. Each is one of the engine's
 * module boundaries; the conductor owns only the order, not the logic.
 */
export interface ConductorDeps {
  readonly trigger: TriggerSource;
  readonly assembler?: ContextAssembler;
  readonly runner?: AgentRunner;
  readonly ciGate: CiGate;
  readonly autoMerge: AutoMerge;
  readonly deployer: CdDeployer;
  readonly oracle: Oracle;
  readonly recorder: RunRecorder;
  readonly cleanup: Cleanup;
}

/**
 * Result returned by {@link runIncident}: the persisted record and the path it
 * was written to.
 */
export interface IncidentResult {
  readonly record: RunRecord;
  readonly recordPath: string;
}

/**
 * Orchestrates one incident run end-to-end. The Conductor wires the module
 * interfaces together and owns the lifecycle ordering only:
 *
 *   poll trigger → assemble context → run agent → CI gate → merge → redeploy
 *   → verify → record → cleanup.
 *
 * The scenario owns fault injection and the confirm-fire gate (it ensures the
 * alert is already firing before the conductor polls); the conductor never
 * starts or stops the fault. Cleanup always runs, even on failure.
 */
export class Conductor {
  readonly #deps: ConductorDeps;
  readonly #assembler: ContextAssembler;
  readonly #runner: AgentRunner;

  constructor(deps: ConductorDeps) {
    this.#deps = deps;
    this.#assembler = deps.assembler ?? new ContextAssembler();
    this.#runner = deps.runner ?? new NoopAgentRunner();
  }

  async run(config: SreforgeConfig): Promise<IncidentResult> {
    const timings: Record<string, number> = {};
    const startedAt = new Date().toISOString();

    let trigger: Trigger | null = null;
    let trajectory: Trajectory | null = null;
    let ci: CiResult | null = null;
    let deploy: DeployResult | null = null;

    try {
      // Phase: trigger — the scenario has already confirmed the alert fired.
      trigger = await timed(timings, "trigger", () =>
        this.#deps.trigger.poll(),
      );
      if (trigger === null) {
        throw new Error(
          `expected alert ${config.expectedAlert} was not firing at poll time`,
        );
      }

      // Phase: context — assemble the neutral brief for the agent.
      const brief = await timed(timings, "context", async () =>
        this.#assembler.assemble(trigger as Trigger, config.agentContext),
      );

      // Phase: run — hand the brief to the agent meta-harness.
      trajectory = await timed(timings, "run", () => this.#runner.run(brief));

      if (!trajectory.submitted || trajectory.diff.trim() === "") {
        // No fix produced: nothing to gate/deploy. Record as failed.
        const record = await this.#finish(config, {
          trigger,
          trajectory,
          ci,
          deploy,
          verdict: "failed",
          score: emptyScore(config),
          timings,
          startedAt,
        });
        return record;
      }

      // Phase: ci — build + existing tests against the run workspace.
      ci = await timed(timings, "ci", () =>
        this.#deps.ciGate.run(config.agentContext.runWorkspace),
      );

      if (!ci.green) {
        // Red gate: no deploy, alert persists, run is rejected.
        const record = await this.#finish(config, {
          trigger,
          trajectory,
          ci,
          deploy,
          verdict: "rejected",
          score: await this.#verify(config, { trigger, trajectory, ci, deploy }),
          timings,
          startedAt,
        });
        return record;
      }

      // Phase: merge — commit the green fix to the run workspace.
      await timed(timings, "merge", () =>
        this.#deps.autoMerge.merge(config.agentContext.runWorkspace),
      );

      // Phase: redeploy — CD-on-merge rebuild + swap of the affected service.
      deploy = await timed(timings, "redeploy", () =>
        this.#deps.deployer.redeploy(config.agentContext.runWorkspace.service),
      );

      // Phase: verify — behavioral oracle, fault still active.
      // trigger + trajectory are guaranteed non-null past the guards above; the
      // assertions are needed because this arrow closure loses `let` narrowing.
      const score = await timed(timings, "verify", () =>
        this.#verify(config, { trigger: trigger!, trajectory: trajectory!, ci, deploy }),
      );

      const verdict: Verdict = score.passed ? "passed" : "failed";

      // Phase: record.
      return await this.#finish(config, {
        trigger,
        trajectory,
        ci,
        deploy,
        verdict,
        score,
        timings,
        startedAt,
      });
    } finally {
      // Phase: cleanup — always restore the baseline for the next run.
      await timed(timings, "cleanup", () =>
        this.#deps.cleanup.reset(config.agentContext.runWorkspace),
      ).catch((err: unknown) => {
        process.stderr.write(
          `[conductor] cleanup failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }
  }

  /** Runs the configured oracle over the assembled oracle context. */
  #verify(
    config: SreforgeConfig,
    parts: Pick<OracleContext, "trigger" | "trajectory" | "ci" | "deploy">,
  ): Promise<OracleScore> {
    const ctx: OracleContext = {
      trigger: parts.trigger,
      trajectory: parts.trajectory,
      ci: parts.ci,
      deploy: parts.deploy,
      mitigation: config.mitigation,
    };
    return this.#deps.oracle.evaluate(ctx);
  }

  /** Builds and persists the RunRecord, returning it with its path. */
  async #finish(
    config: SreforgeConfig,
    parts: {
      readonly trigger: Trigger;
      readonly trajectory: Trajectory;
      readonly ci: CiResult | null;
      readonly deploy: DeployResult | null;
      readonly verdict: Verdict;
      readonly score: OracleScore;
      readonly timings: Record<string, number>;
      readonly startedAt: string;
    },
  ): Promise<IncidentResult> {
    const record: RunRecord = {
      runId: config.runId,
      scenarioId: config.scenarioId,
      profile: config.profile,
      trigger: parts.trigger,
      trajectory: parts.trajectory,
      diff: parts.trajectory.diff,
      ci: parts.ci,
      deploy: parts.deploy,
      score: parts.score,
      verdict: parts.verdict,
      timings: toPhaseTimings(parts.timings),
      startedAt: parts.startedAt,
      finishedAt: new Date().toISOString(),
    };

    const recordPath = await timed(parts.timings, "record", () =>
      this.#deps.recorder.record(record),
    );
    return { record, recordPath };
  }
}

/**
 * Top-level entry point: construct a {@link Conductor} from explicit deps and
 * run one incident. This is the engine's public sequencing surface.
 */
export function runIncident(
  config: SreforgeConfig,
  deps: ConductorDeps,
): Promise<IncidentResult> {
  return new Conductor(deps).run(config);
}

/** Times an async phase, recording its duration in milliseconds. */
async function timed<T>(
  timings: Record<string, number>,
  phase: RunPhase,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    timings[phase] = (timings[phase] ?? 0) + (Date.now() - start);
  }
}

/** Narrows the mutable timing accumulator to the immutable record shape. */
function toPhaseTimings(timings: Record<string, number>): PhaseTimings {
  return { ...timings } as PhaseTimings;
}

/** A zeroed score for runs that produced no gradeable fix. */
function emptyScore(config: SreforgeConfig): OracleScore {
  return {
    oracleId: "none",
    score: 0,
    passed: false,
    signals: [
      {
        id: "no_submission",
        satisfied: false,
        value: 0,
        weight: 1,
        detail: `no fix submitted for ${config.expectedAlert}`,
      },
    ],
  };
}
