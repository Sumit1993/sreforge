import assert from "node:assert/strict";
import test from "node:test";
import {
	assembleT0Bundle,
	assertSymptomLevel,
	renderT0Bundle,
} from "../dist/context/t0-bundle.js";

test("assembleT0Bundle - assembly shape and assembled_at = max firedAt", () => {
	const trigger = {
		source: "trigger-bus",
		alertName: "PrimaryAlert",
		severity: "critical",
		labels: { app: "foo" },
		annotations: { msg: "bad" },
		firedAt: "2026-06-25T10:15:30Z",
		signals: [
			{
				alertName: "PrimaryAlert",
				severity: "critical",
				labels: { app: "foo" },
				annotations: { msg: "bad" },
				firedAt: "2026-06-25T10:15:30Z",
			},
			{
				alertName: "SecondaryAlert",
				labels: {},
				annotations: {},
				firedAt: "2026-06-25T10:15:45Z",
			},
		],
	};

	const slackTriage = [
		{ channel: "alerts", user: "U1", ts: "12345.67", text: "looking into it" },
	];

	const bundle = assembleT0Bundle({ runId: "r-1", trigger, slackTriage });

	assert.equal(bundle.schema_version, "t0-bundle.v1");
	assert.equal(bundle.incident_id, "r-1");
	assert.equal(bundle.assembled_at, "2026-06-25T10:15:45Z"); // max firedAt
	assert.equal(bundle.signals.length, 2);
	assert.equal(bundle.slack_triage.length, 1);

	// Stable rendering test
	const rendered = renderT0Bundle(bundle);
	assert.ok(rendered.includes("schema_version"));
});

test("assertSymptomLevel - throws on poisoned annotation", () => {
	const trigger = {
		source: "prometheus-alert",
		alertName: "Alert1",
		labels: {},
		annotations: { summary: "The root cause is a bad patch" },
		firedAt: "2026-06-25T10:15:30Z",
	};

	assert.throws(() => {
		assembleT0Bundle({ runId: "r-1", trigger, slackTriage: [] });
	}, /Poisoned content found/);
});
