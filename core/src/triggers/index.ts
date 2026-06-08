import type { Trigger } from "../types.js";

/**
 * An event source the engine polls to open an incident run.
 *
 * `poll()` returns a normalized {@link Trigger} when the source is firing, or
 * `null` when it is quiet. The engine (and the scenario's confirm-fire gate)
 * decides what to do with a fired trigger; the source only reports.
 */
export interface TriggerSource {
  poll(): Promise<Trigger | null>;
}

export { PrometheusAlertTrigger } from "./prometheus-alert.js";
export type { PrometheusAlertTriggerOptions } from "./prometheus-alert.js";
