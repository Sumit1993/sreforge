import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPoll, parseRequireBaseline, runQuiesceLoop } from "../confirm-quiesced.mjs";

describe("confirm-quiesced classification and loop tests", () => {
	const healthyTargets = [
		{ health: "up", labels: { job: "booklogr-api" } },
		{ health: "up", labels: { job: "book-metadata" } },
		{ health: "up", labels: { job: "prometheus" } },
	];

	it("1. all-clean, targets up, baseline>0, requireBaseline=1 -> clean:true", () => {
		const res = classifyPoll({
			alerts: [],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.firing, []);
		assert.deepEqual(res.pending, []);
		assert.deepEqual(res.targetsDown, []);
		assert.equal(res.baselinePresent, true);
		assert.equal(res.baselineOk, true);
	});

	it("2. one state:'firing' alert -> clean:false, firing:[name]", () => {
		const alerts = [
			{ state: "firing", labels: { alertname: "BooklogrApiLatencyP99High" } },
		];
		const res = classifyPoll({
			alerts,
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.firing, ["BooklogrApiLatencyP99High"]);
		assert.deepEqual(res.pending, []);
	});

	it("3. one state:'pending' alert -> clean:false, pending:[name]", () => {
		const alerts = [
			{ state: "pending", labels: { alertname: "BooklogrApiLatencyP99High" } },
		];
		const res = classifyPoll({
			alerts,
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.firing, []);
		assert.deepEqual(res.pending, ["BooklogrApiLatencyP99High"]);
	});

	it("4. a target with health:'down' -> clean:false, targetsDown names it", () => {
		const targets = [
			{ health: "up", labels: { job: "booklogr-api" } },
			{ health: "down", labels: { job: "book-metadata" } },
		];
		const res = classifyPoll({
			alerts: [],
			targets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.targetsDown, ["book-metadata"]);
	});

	it("5. requireBaseline:1 and baseline:0 -> clean:false, baselineOk:false; same with requireBaseline:0 -> clean:true", () => {
		const reqRes = classifyPoll({
			alerts: [],
			targets: healthyTargets,
			baseline: 0,
			requireBaseline: 1,
		});
		assert.equal(reqRes.clean, false);
		assert.equal(reqRes.baselineOk, false);

		const noReqRes = classifyPoll({
			alerts: [],
			targets: healthyTargets,
			baseline: 0,
			requireBaseline: 0,
		});
		assert.equal(noReqRes.clean, true);
		assert.equal(noReqRes.baselineOk, true);
	});

	it("6. streak logic: dirty poll after 2 clean resets cleanStreak to 0", async () => {
		let clock = 1000;
		const nowFn = () => clock;
		const sleepFn = (ms) => {
			clock += ms;
		};

		let callCount = 0;
		const fetchPoll = async () => {
			callCount++;
			// Polls 1 & 2: clean; Poll 3: dirty (firing); Polls 4, 5, 6: clean
			if (callCount === 3) {
				return {
					alerts: [
						{ state: "firing", labels: { alertname: "TransientAlert" } },
					],
					targets: healthyTargets,
					baseline: 1.0,
				};
			}
			return {
				alerts: [],
				targets: healthyTargets,
				baseline: 1.0,
			};
		};

		const res = await runQuiesceLoop({
			fetchPoll,
			deadlineS: 100,
			intervalS: 1,
			settle: 3,
			requireBaseline: 1,
			nowFn,
			sleepFn,
			logStderr: false,
			logStdout: false,
		});

		assert.equal(res.ok, true);
		assert.equal(res.state, "quiesced");
		assert.equal(res.settle_checks, 3);
		// Call 1 (clean, streak 1), Call 2 (clean, streak 2), Call 3 (dirty, streak 0), Call 4 (clean, streak 1), Call 5 (clean, streak 2), Call 6 (clean, streak 3) -> 6 calls total
		assert.equal(callCount, 6);
	});

	it("7. deadline path: clock never clean -> loop exits with quiesce_timeout shape", async () => {
		let clock = 1000;
		const nowFn = () => clock;
		const sleepFn = (ms) => {
			clock += ms;
		};

		const fetchPoll = async () => ({
			alerts: [{ state: "firing", labels: { alertname: "PersistentAlert" } }],
			targets: healthyTargets,
			baseline: 0,
		});

		const res = await runQuiesceLoop({
			fetchPoll,
			deadlineS: 10,
			intervalS: 2,
			settle: 3,
			requireBaseline: 1,
			nowFn,
			sleepFn,
			logStderr: false,
			logStdout: false,
		});

		assert.equal(res.ok, false);
		assert.equal(res.state, "quiesce_timeout");
		assert.deepEqual(res.unsettled.firing, ["PersistentAlert"]);
		assert.equal(res.unsettled.baseline_present, false);
	});

	it("8. fetchPoll throws persistently -> prometheus_unreachable and fetch_error reported", async () => {
		let clock = 1000;
		const nowFn = () => clock;
		const sleepFn = (ms) => {
			clock += ms;
		};

		const fetchPoll = async () => {
			throw new Error("fetch failed: ECONNREFUSED");
		};

		const res = await runQuiesceLoop({
			fetchPoll,
			deadlineS: 10,
			intervalS: 2,
			settle: 3,
			requireBaseline: 1,
			nowFn,
			sleepFn,
			logStderr: false,
			logStdout: false,
		});

		assert.equal(res.ok, false);
		assert.equal(res.state, "quiesce_timeout");
		assert.equal(res.prometheus_unreachable, true);
		assert.equal(res.fetch_error, "fetch failed: ECONNREFUSED");
		assert.deepEqual(res.unsettled.firing, []);
	});

	it("9. parseRequireBaseline parses bare flag, numbers, booleans, and strings", () => {
		assert.equal(parseRequireBaseline("true", 0), 1);
		assert.equal(parseRequireBaseline("1", 0), 1);
		assert.equal(parseRequireBaseline("", 0), 1);
		assert.equal(parseRequireBaseline(true, 0), 1);

		assert.equal(parseRequireBaseline("false", 1), 0);
		assert.equal(parseRequireBaseline("0", 1), 0);
		assert.equal(parseRequireBaseline(false, 1), 0);

		assert.equal(parseRequireBaseline(undefined, 0), 0);
		assert.equal(parseRequireBaseline(undefined, 1), 1);
	});
});
