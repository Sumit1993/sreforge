import type { Trigger, TriggerSignal } from "../types.js";

export interface SlackTriageMessage {
	readonly channel: string;
	readonly user: string;
	readonly ts: string;
	readonly text: string;
}

export interface T0Bundle {
	readonly schema_version: "t0-bundle.v1";
	readonly incident_id: string;
	readonly assembled_at: string;
	readonly signals: readonly TriggerSignal[];
	readonly slack_triage: readonly SlackTriageMessage[];
}

export function assertSymptomLevel(bundle: T0Bundle): void {
	const POISON_RX = /root.?cause|oracle|fix\.patch|solution\//i;

	const check = (val: string, path: string) => {
		if (POISON_RX.test(val)) {
			throw new Error(`Poisoned content found in ${path}`);
		}
	};

	for (let i = 0; i < bundle.signals.length; i++) {
		const s = bundle.signals[i]!;
		for (const [k, v] of Object.entries(s.annotations))
			check(v, `signals[${i}].annotations[${k}]`);
		for (const [k, v] of Object.entries(s.labels))
			check(v, `signals[${i}].labels[${k}]`);
	}

	for (let i = 0; i < bundle.slack_triage.length; i++) {
		check(bundle.slack_triage[i]!.text, `slack_triage[${i}].text`);
	}
}

export interface AssembleT0BundleOptions {
	readonly runId: string;
	readonly trigger: Trigger;
	readonly slackTriage: readonly SlackTriageMessage[];
}

export function assembleT0Bundle(opts: AssembleT0BundleOptions): T0Bundle {
	const signals = opts.trigger.signals ?? [
		{
			alertName: opts.trigger.alertName,
			severity: opts.trigger.severity,
			labels: opts.trigger.labels,
			annotations: opts.trigger.annotations,
			firedAt: opts.trigger.firedAt,
		},
	];

	let maxFiredAt = signals[0]!.firedAt;
	for (const s of signals) {
		if (new Date(s.firedAt).getTime() > new Date(maxFiredAt).getTime()) {
			maxFiredAt = s.firedAt;
		}
	}

	const bundle: T0Bundle = {
		schema_version: "t0-bundle.v1",
		incident_id: opts.runId,
		assembled_at: maxFiredAt,
		signals,
		slack_triage: opts.slackTriage,
	};

	assertSymptomLevel(bundle);

	return bundle;
}

export function renderT0Bundle(bundle: T0Bundle): string {
	// Stable key order
	const ordered = {
		schema_version: bundle.schema_version,
		incident_id: bundle.incident_id,
		assembled_at: bundle.assembled_at,
		signals: bundle.signals.map((s) => ({
			alertName: s.alertName,
			severity: s.severity,
			labels: Object.fromEntries(Object.entries(s.labels).sort()),
			annotations: Object.fromEntries(Object.entries(s.annotations).sort()),
			firedAt: s.firedAt,
		})),
		slack_triage: bundle.slack_triage.map((m) => ({
			channel: m.channel,
			user: m.user,
			ts: m.ts,
			text: m.text,
		})),
	};
	return JSON.stringify(ordered, null, 2);
}
