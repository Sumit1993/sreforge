import type { Trigger, TriggerSignal } from "../types.js";
import type { TriggerSource } from "./index.js";
import { fetchPrometheusAlerts, toTriggerSignal } from "./prometheus-alert.js";

/**
 * Correlates signals within a given time window.
 * Sort by firedAt, group signals within windowMs of the first signal.
 * Deduplicates identical signals (alertName + labels) keeping the earliest.
 */
export function correlateSignals(
	signals: TriggerSignal[],
	opts: { windowMs: number },
): TriggerSignal[][] {
	if (signals.length === 0) return [];

	// Sort chronologically
	const sorted = [...signals].sort(
		(a, b) => new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime(),
	);

	const groups: TriggerSignal[][] = [];
	let currentGroup: TriggerSignal[] = [];
	let groupStartMs = 0;

	for (const sig of sorted) {
		const t = new Date(sig.firedAt).getTime();
		if (currentGroup.length === 0) {
			currentGroup = [sig];
			groupStartMs = t;
		} else if (t - groupStartMs <= opts.windowMs) {
			// Deduplicate
			const fp = (s: TriggerSignal) =>
				`${s.alertName}:${JSON.stringify(
					Object.entries(s.labels).sort((a, b) => a[0].localeCompare(b[0])),
				)}`;
			const seen = new Set(currentGroup.map(fp));
			if (!seen.has(fp(sig))) {
				currentGroup.push(sig);
			}
		} else {
			groups.push(currentGroup);
			currentGroup = [sig];
			groupStartMs = t;
		}
	}
	if (currentGroup.length > 0) {
		groups.push(currentGroup);
	}

	return groups;
}

export interface TriggerBusOptions {
	readonly sources: TriggerSource[];
	readonly windowMs?: number;
	readonly primaryAlertName?: string;
}

/**
 * Polls multiple sources and correlates their signals into a single Trigger.
 */
export class TriggerBus implements TriggerSource {
	readonly #sources: TriggerSource[];
	readonly #windowMs: number;
	readonly #primaryAlertName?: string;

	constructor(opts: TriggerBusOptions) {
		this.#sources = opts.sources;
		this.#windowMs = opts.windowMs ?? 60_000;
		this.#primaryAlertName = opts.primaryAlertName;
	}

	async poll(): Promise<Trigger | null> {
		const triggers = await Promise.all(this.#sources.map((s) => s.poll()));
		const signals: TriggerSignal[] = [];

		for (const t of triggers) {
			if (!t) continue;
			if (t.signals) {
				signals.push(...t.signals);
			} else {
				// Fallback for single-alert triggers
				signals.push({
					alertName: t.alertName,
					severity: t.severity,
					labels: { ...t.labels },
					annotations: { ...t.annotations },
					firedAt: t.firedAt,
				});
			}
		}

		if (signals.length === 0) return null;

		const groups = correlateSignals(signals, { windowMs: this.#windowMs });
		if (groups.length === 0) return null;

		let targetGroup = groups[0]!;
		if (this.#primaryAlertName) {
			const p = groups.find((g) =>
				g.some((s) => s.alertName === this.#primaryAlertName),
			);
			if (!p) return null; // Primary is required if specified
			targetGroup = p;
		}

		// Ensure primary is signals[0] if primaryAlertName is given
		if (this.#primaryAlertName) {
			const pIdx = targetGroup.findIndex(
				(s) => s.alertName === this.#primaryAlertName,
			);
			if (pIdx > 0) {
				const p = targetGroup[pIdx]!;
				targetGroup.splice(pIdx, 1);
				targetGroup.unshift(p);
			}
		}

		const primary = targetGroup[0]!;

		return {
			source: "trigger-bus",
			alertName: primary.alertName,
			severity: primary.severity,
			labels: primary.labels,
			annotations: primary.annotations,
			firedAt: primary.firedAt,
			signals: targetGroup,
		};
	}
}

export interface MultiAlertTriggerOptions {
	readonly prometheusUrl: string;
	readonly alertNames: string[];
	readonly primary: string;
}

/**
 * Matches a set of alerts from Prometheus, returning them as a single Trigger
 * if the primary is firing.
 */
export class MultiAlertTrigger implements TriggerSource {
	readonly #prometheusUrl: string;
	readonly #alertNames: Set<string>;
	readonly #primary: string;

	constructor(opts: MultiAlertTriggerOptions) {
		this.#prometheusUrl = opts.prometheusUrl.replace(/\/+$/, "");
		this.#alertNames = new Set(opts.alertNames);
		this.#primary = opts.primary;
	}

	async poll(): Promise<Trigger | null> {
		const alerts = await fetchPrometheusAlerts(this.#prometheusUrl);
		const firing = alerts.filter(
			(a) =>
				a.state === "firing" &&
				a.labels?.alertname &&
				this.#alertNames.has(a.labels.alertname),
		);

		const primaryFiring = firing.find(
			(a) => a.labels?.alertname === this.#primary,
		);
		if (!primaryFiring) return null;

		const signals = firing.map((a) =>
			toTriggerSignal(a.labels?.alertname || "", a),
		);

		// Ensure primary is first
		const pIdx = signals.findIndex((s) => s.alertName === this.#primary);
		if (pIdx > 0) {
			const p = signals[pIdx]!;
			signals.splice(pIdx, 1);
			signals.unshift(p);
		}

		const primary = signals[0]!;

		return {
			source: "multi-alert",
			alertName: primary.alertName,
			severity: primary.severity,
			labels: primary.labels,
			annotations: primary.annotations,
			firedAt: primary.firedAt,
			signals,
		};
	}
}
