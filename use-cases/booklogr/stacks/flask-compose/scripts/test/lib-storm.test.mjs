import assert from "node:assert/strict";
import test from "node:test";
import { mergeNotifications, parseCaptureFile, parseTriageFeed } from "../lib-storm.mjs";

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

test("parseCaptureFile - single payload with trailing separator", () => {
	const raw = '{"test":1}\x1e';
	const res = parseCaptureFile(raw);
	assert.deepEqual(res, [{ test: 1 }]);
});

test("parseCaptureFile - three payloads", () => {
	const raw = '{"a":1}\x1e{"b":2}\x1e{"c":3}\x1e';
	const res = parseCaptureFile(raw);
	assert.deepEqual(res, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test("parseCaptureFile - throws on bad json with index", () => {
	const raw = '{"a":1}\x1ebad\x1e{"c":3}\x1e';
	assert.throws(() => parseCaptureFile(raw), /index 1/);
});

test("parseTriageFeed - three messages + trailing newline", () => {
	const raw = '{"a":1}\n{"b":2}\n{"c":3}\n';
	const res = parseTriageFeed(raw);
	assert.deepEqual(res, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test("parseTriageFeed - corrupt middle line drops one", () => {
	const raw = '{"a":1}\nbad json\n{"c":3}\n';
	const res = parseTriageFeed(raw);
	assert.deepEqual(res, [{ a: 1 }, { c: 3 }]);
});
