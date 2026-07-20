import assert from "node:assert/strict";
import test from "node:test";
import { mergeNotifications } from "../lib-storm.mjs";

test("mergeNotifications - dedupes by fingerprint and fallback", () => {
	const payloads = [
		{
			alerts: [
				{
					fingerprint: "f1",
					labels: { alertname: "A", sev: "high" },
					startsAt: "t1",
				},
				{ labels: { alertname: "B", sev: "low" }, startsAt: "t1" },
			],
		},
		{
			alerts: [
				{
					fingerprint: "f1",
					labels: { alertname: "A", sev: "high" },
					startsAt: "t2",
				},
				{ labels: { alertname: "B", sev: "low" }, startsAt: "t2" },
				{ fingerprint: "f2", labels: { alertname: "C" }, startsAt: "t2" },
			],
		},
	];

	const merged = mergeNotifications(payloads);
	assert.equal(merged.schema_version, "storm-capture.v1");
	assert.equal(merged.notifications.length, 2);
	assert.equal(merged.alerts.length, 3);

	// Fingerprint dedupe
	const f1 = merged.alerts.filter((a) => a.fingerprint === "f1");
	assert.equal(f1.length, 1);
	assert.equal(f1[0].startsAt, "t1");

	// Fallback dedupe
	const b = merged.alerts.filter((a) => a.labels && a.labels.alertname === "B");
	assert.equal(b.length, 1);
	assert.equal(b[0].startsAt, "t1");

	// New alert in second payload
	const c = merged.alerts.filter((a) => a.fingerprint === "f2");
	assert.equal(c.length, 1);
});
