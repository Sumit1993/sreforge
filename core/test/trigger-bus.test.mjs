import assert from "node:assert/strict";
import test from "node:test";
import {
	correlateSignals,
	MultiAlertTrigger,
	TriggerBus,
} from "../dist/triggers/trigger-bus.js";

test("correlateSignals - groups within window and dedupes", () => {
	const signals = [
		{
			alertName: "A",
			severity: "high",
			labels: { k: "1" },
			annotations: {},
			firedAt: "2026-06-25T10:15:30Z",
		}, // t=0
		{
			alertName: "B",
			severity: "low",
			labels: { k: "2" },
			annotations: {},
			firedAt: "2026-06-25T10:15:45Z",
		}, // t=15
		{
			alertName: "A",
			severity: "high",
			labels: { k: "1" },
			annotations: {},
			firedAt: "2026-06-25T10:15:50Z",
		}, // t=20 (dup of A)
		{
			alertName: "C",
			severity: "critical",
			labels: { k: "3" },
			annotations: {},
			firedAt: "2026-06-25T10:16:40Z",
		}, // t=70 (outside 60s window)
	];

	const groups = correlateSignals(signals, { windowMs: 60000 });

	assert.equal(groups.length, 2);

	// Group 1: A and B
	assert.equal(groups[0].length, 2);
	assert.equal(groups[0][0].alertName, "A");
	assert.equal(groups[0][1].alertName, "B");

	// Group 2: C
	assert.equal(groups[1].length, 1);
	assert.equal(groups[1][0].alertName, "C");
});

test("TriggerBus - polls multiple sources, correlates, respects primaryAlertName", async () => {
	const stubSource1 = {
		poll: async () => ({
			source: "prometheus-alert",
			alertName: "Alert1",
			labels: {},
			annotations: {},
			firedAt: "2026-06-25T10:15:30Z",
		}),
	};

	const stubSource2 = {
		poll: async () => ({
			source: "prometheus-alert",
			alertName: "PrimaryAlert",
			severity: "critical",
			labels: { app: "foo" },
			annotations: { msg: "bad" },
			firedAt: "2026-06-25T10:15:35Z",
		}),
	};

	const bus = new TriggerBus({
		sources: [stubSource1, stubSource2],
		windowMs: 60000,
		primaryAlertName: "PrimaryAlert",
	});

	const trigger = await bus.poll();
	assert.ok(trigger);
	assert.equal(trigger.alertName, "PrimaryAlert");
	assert.equal(trigger.severity, "critical");
	assert.equal(trigger.signals.length, 2);
	assert.equal(trigger.signals[0].alertName, "PrimaryAlert"); // Primary must be first
	assert.equal(trigger.signals[1].alertName, "Alert1");
	assert.equal(trigger.source, "trigger-bus");
});

test("TriggerBus - returns null if primary missing", async () => {
	const stubSource1 = {
		poll: async () => ({
			source: "prometheus-alert",
			alertName: "Alert1",
			labels: {},
			annotations: {},
			firedAt: "2026-06-25T10:15:30Z",
		}),
	};

	const bus = new TriggerBus({
		sources: [stubSource1],
		windowMs: 60000,
		primaryAlertName: "PrimaryAlert",
	});

	const trigger = await bus.poll();
	assert.equal(trigger, null);
});
