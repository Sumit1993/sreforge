import type { Trigger } from "../types.js";
import type { TriggerSource } from "./index.js";

/** Configuration for a {@link PrometheusAlertTrigger}. */
export interface PrometheusAlertTriggerOptions {
  /** Base URL of the Prometheus server, e.g. `http://localhost:9090`. */
  readonly prometheusUrl: string;
  /** Name of the alert that opens the run, e.g. `TodoApiLatencyP99High`. */
  readonly alertName: string;
}

/**
 * The shape of a single alert in the Prometheus `/api/v1/alerts` response.
 * Only the fields the engine consumes are modeled; the rest is ignored.
 */
interface PrometheusAlert {
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
  readonly state?: string;
  readonly activeAt?: string;
}

interface PrometheusAlertsResponse {
  readonly status?: string;
  readonly data?: { readonly alerts?: readonly PrometheusAlert[] };
}

/**
 * Reads Prometheus `/api/v1/alerts` and emits a {@link Trigger} when the named
 * alert is firing. This is the only trigger source in v1; multi-signal/Slack
 * triggers are the v2 trigger-bus generalization.
 */
export class PrometheusAlertTrigger implements TriggerSource {
  readonly #prometheusUrl: string;
  readonly #alertName: string;

  constructor(options: PrometheusAlertTriggerOptions) {
    this.#prometheusUrl = options.prometheusUrl.replace(/\/+$/, "");
    this.#alertName = options.alertName;
  }

  async poll(): Promise<Trigger | null> {
    const response = await fetch(`${this.#prometheusUrl}/api/v1/alerts`);
    if (!response.ok) {
      throw new Error(
        `Prometheus /api/v1/alerts returned HTTP ${response.status}`,
      );
    }

    const payload: unknown = await response.json();
    const alerts = extractAlerts(payload);

    const firing = alerts.find(
      (alert) =>
        alert.state === "firing" &&
        alert.labels?.alertname === this.#alertName,
    );
    if (firing === undefined) {
      return null;
    }

    return toTrigger(this.#alertName, firing);
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

/** Builds an immutable {@link Trigger} from a firing Prometheus alert. */
function toTrigger(alertName: string, alert: PrometheusAlert): Trigger {
  const labels = alert.labels ?? {};
  return {
    source: "prometheus-alert",
    alertName,
    severity: labels.severity,
    labels: { ...labels },
    annotations: { ...(alert.annotations ?? {}) },
    firedAt: alert.activeAt ?? new Date().toISOString(),
  };
}
