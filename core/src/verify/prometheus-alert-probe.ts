import type { AlertProbe } from "./index.js";

/** Configuration for a {@link PrometheusAlertProbe}. */
export interface PrometheusAlertProbeOptions {
  /** Base URL of the Prometheus server, e.g. `http://localhost:9090`. */
  readonly prometheusUrl: string;
  /**
   * Optional monotonic clock, in milliseconds. Injectable so the oracle's
   * time-based logic (time-to-clear, sustained-clear) is deterministic in
   * tests. Defaults to `Date.now`.
   */
  readonly clock?: () => number;
}

/** The subset of a Prometheus `/api/v1/alerts` entry the probe consumes. */
interface PrometheusAlert {
  readonly labels?: Record<string, string>;
  readonly state?: string;
}

interface PrometheusAlertsResponse {
  readonly data?: { readonly alerts?: readonly PrometheusAlert[] };
}

/**
 * The live alert-state reader that backs {@link MitigationOracle} during
 * behavioral verification.
 *
 * It reads Prometheus `/api/v1/alerts` directly — the same deterministic source
 * of truth the confirm-fire / verify-clear scripts use — rather than
 * Alertmanager, so there is no `group_wait` latency between a fix taking effect
 * and the oracle observing the alert clear. This is the runtime counterpart of
 * the `PrometheusAlertTrigger` (which opens the run); the probe closes it.
 */
export class PrometheusAlertProbe implements AlertProbe {
  readonly #prometheusUrl: string;
  readonly #clock: () => number;

  constructor(options: PrometheusAlertProbeOptions) {
    this.#prometheusUrl = options.prometheusUrl.replace(/\/+$/, "");
    this.#clock = options.clock ?? Date.now;
  }

  async isFiring(alertName: string): Promise<boolean> {
    const alerts = await this.#fetchAlerts();
    return alerts.some(
      (alert) =>
        alert.state === "firing" && alert.labels?.alertname === alertName,
    );
  }

  async firingAlerts(): Promise<readonly string[]> {
    const alerts = await this.#fetchAlerts();
    const names = alerts
      .filter((alert) => alert.state === "firing")
      .map((alert) => alert.labels?.alertname)
      .filter((name): name is string => typeof name === "string");
    return [...new Set(names)];
  }

  now(): number {
    return this.#clock();
  }

  /** Reads and narrows the current alert list from Prometheus. */
  async #fetchAlerts(): Promise<readonly PrometheusAlert[]> {
    const response = await fetch(`${this.#prometheusUrl}/api/v1/alerts`);
    if (!response.ok) {
      throw new Error(
        `Prometheus /api/v1/alerts returned HTTP ${response.status}`,
      );
    }
    const payload: unknown = await response.json();
    return extractAlerts(payload);
  }
}

/** Narrows the untyped JSON body into the alert list we understand. */
function extractAlerts(payload: unknown): readonly PrometheusAlert[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const data = (payload as PrometheusAlertsResponse).data;
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const alerts = data.alerts;
  return Array.isArray(alerts) ? alerts : [];
}
