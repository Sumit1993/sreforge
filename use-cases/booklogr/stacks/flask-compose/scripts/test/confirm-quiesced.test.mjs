import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	classifyPoll,
	isOutOfScopeAlert,
	parseRequireBaseline,
	readScenarioServices,
	runQuiesceLoop,
} from "../confirm-quiesced.mjs";

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

	// ── #121: ambient furniture must not gate quiesce ──────────────────────────
	// EdgeClientRequestJitter reduces to `time() % 120 < 60`, so it is firing half
	// of all wall-clock time no matter what the stack is doing. Before these cases
	// the gate could only settle during its 60s down-phase.
	const ambientFiring = {
		state: "firing",
		labels: {
			alertname: "EdgeClientRequestJitter",
			service: "edge-client",
			role: "ambient",
		},
	};

	it("10. a firing role:ambient alert alone still counts as quiesced", () => {
		const res = classifyPoll({
			alerts: [ambientFiring],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.firing, []);
		assert.deepEqual(res.pending, []);
		// Exempted, not invisible — the operator must be able to see it was ignored.
		assert.deepEqual(res.ambient, ["EdgeClientRequestJitter"]);
	});

	it("11. a pending role:ambient alert alone still counts as quiesced", () => {
		const res = classifyPoll({
			alerts: [{ ...ambientFiring, state: "pending" }],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.pending, []);
		assert.deepEqual(res.ambient, ["EdgeClientRequestJitter"]);
	});

	it("12. ambient exemption does not mask a real firing alert", () => {
		const res = classifyPoll({
			alerts: [
				ambientFiring,
				{
					state: "firing",
					labels: {
						alertname: "BooklogrApiHighErrorRate",
						service: "booklogr-api",
					},
				},
			],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.firing, ["BooklogrApiHighErrorRate"]);
		assert.deepEqual(res.ambient, ["EdgeClientRequestJitter"]);
	});

	it("13. ambient exemption does not mask a real PENDING alert (the #95 shape)", () => {
		const res = classifyPoll({
			alerts: [
				ambientFiring,
				{
					state: "pending",
					labels: {
						alertname: "BookMetadataTrafficStalled",
						service: "book-metadata",
					},
				},
			],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.pending, ["BookMetadataTrafficStalled"]);
	});

	it("14. only role:ambient is exempt — another role value still gates", () => {
		const res = classifyPoll({
			alerts: [
				{
					state: "firing",
					labels: {
						alertname: "SomeOtherRule",
						service: "booklogr-api",
						role: "diagnosis",
					},
				},
			],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.firing, ["SomeOtherRule"]);
		assert.deepEqual(res.ambient, []);
	});

	it("15. an inactive ambient alert is not reported as exempt", () => {
		const res = classifyPoll({
			alerts: [{ ...ambientFiring, state: "inactive" }],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.ambient, []);
	});

	// ── #95: the gate must not block on an alert the scenario does not grade ────
	// The measured deadlock was BookMetadataTrafficStalled pending during
	// latency-cache-stampede, whose [verify] services is ["booklogr-api"] only.
	// ADR-0006 (amended 2026-07-21) already scopes no_new_alerts this way; the
	// quiesce gate was still asserting globally.
	const stalledPending = {
		state: "pending",
		labels: {
			alertname: "BookMetadataTrafficStalled",
			service: "book-metadata",
		},
	};

	it("17. the #95 deadlock: out-of-scope pending alert no longer blocks", () => {
		const res = classifyPoll({
			alerts: [stalledPending],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
			services: ["booklogr-api"],
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.pending, []);
		assert.deepEqual(res.outOfScope, ["BookMetadataTrafficStalled"]);
	});

	it("18. the same alert DOES block a scenario that declares its service", () => {
		// worker-cpu-starvation grades book-metadata, so there the collapse is a
		// real coupled signal and must still gate.
		const res = classifyPoll({
			alerts: [stalledPending],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
			services: ["booklogr-api", "book-metadata"],
		});
		assert.equal(res.clean, false);
		assert.deepEqual(res.pending, ["BookMetadataTrafficStalled"]);
		assert.deepEqual(res.outOfScope, []);
	});

	it("19. no declared scope -> strict global gate (fail-closed)", () => {
		for (const services of [null, []]) {
			const res = classifyPoll({
				alerts: [stalledPending],
				targets: healthyTargets,
				baseline: 1.5,
				requireBaseline: 1,
				services,
			});
			assert.equal(res.clean, false, `services=${JSON.stringify(services)}`);
			assert.deepEqual(res.pending, ["BookMetadataTrafficStalled"]);
		}
	});

	it("20. an in-scope alert still blocks, and an unlabelled alert is never exempt", () => {
		const inScope = classifyPoll({
			alerts: [
				{
					state: "firing",
					labels: {
						alertname: "BooklogrApiHighErrorRate",
						service: "booklogr-api",
					},
				},
			],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
			services: ["booklogr-api"],
		});
		assert.equal(inScope.clean, false);
		assert.deepEqual(inScope.firing, ["BooklogrApiHighErrorRate"]);

		// A rule with no service label must not buy an exemption by omission.
		const unlabelled = classifyPoll({
			alerts: [{ state: "firing", labels: { alertname: "NoServiceLabel" } }],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
			services: ["booklogr-api"],
		});
		assert.equal(unlabelled.clean, false);
		assert.deepEqual(unlabelled.firing, ["NoServiceLabel"]);
	});

	it("21. isOutOfScopeAlert edge cases", () => {
		assert.equal(isOutOfScopeAlert(stalledPending, ["booklogr-api"]), true);
		assert.equal(
			isOutOfScopeAlert(stalledPending, ["booklogr-api", "book-metadata"]),
			false,
		);
		assert.equal(isOutOfScopeAlert(stalledPending, null), false);
		assert.equal(isOutOfScopeAlert(stalledPending, []), false);
		assert.equal(isOutOfScopeAlert({ labels: {} }, ["booklogr-api"]), false);
	});

	it("22. readScenarioServices reads the real shipped manifests", () => {
		// The 6 verdict scenarios scope booklogr-api only; worker-cpu-starvation
		// additionally grades book-metadata. That asymmetry is what makes scoping
		// the correct fix for #95 rather than a rule change.
		const stampede = readScenarioServices("latency-cache-stampede");
		assert.deepEqual(stampede.services, ["booklogr-api"]);

		const worker = readScenarioServices("worker-cpu-starvation");
		assert.deepEqual(worker.services, ["booklogr-api", "book-metadata"]);

		// Fallbacks report WHY, so an unscoped gate is never silent.
		const missing = readScenarioServices("does-not-exist");
		assert.equal(missing.services, null);
		assert.match(missing.reason, /no manifest/);

		const none = readScenarioServices("");
		assert.equal(none.services, null);
		assert.match(none.reason, /no SCENARIO_ID/);
	});

	it("23. every shipped scenario resolves a scope — none silently falls back", () => {
		// A scenario that fails to resolve `[verify] services` reverts to the strict
		// global gate, which is where #95 lives. Silent per-scenario regression to the
		// buggy behaviour is the failure mode this pins.
		const scenariosDir = fileURLToPath(
			new URL("../../../../scenarios", import.meta.url),
		);
		const ids = readdirSync(scenariosDir, { withFileTypes: true })
			.filter(
				(e) =>
					e.isDirectory() &&
					existsSync(join(scenariosDir, e.name, "scenario.toml")),
			)
			.map((e) => e.name);

		assert.ok(ids.length >= 7, `expected >=7 scenarios, found ${ids.length}`);
		const unscoped = ids.filter((id) => !readScenarioServices(id).services);
		assert.deepEqual(
			unscoped,
			[],
			`these scenarios would fall back to the unscoped gate: ${unscoped.join(", ")}`,
		);
	});

	it("24. role:ambient beats declared scope (deliberate precedence)", () => {
		// If a scenario ever declared the ambient service, `role: ambient` still wins:
		// classifyPoll checks isAmbientAlert first. That is intentional — the metronome
		// is never quiet, so gating on it can never succeed — but it means the gate and
		// the oracle would disagree for such a scenario, which is why rules-lint
		// forbids declaring edge-client in [verify] services. Pinned so the precedence
		// cannot be "simplified" without someone reading this comment.
		const res = classifyPoll({
			alerts: [ambientFiring],
			targets: healthyTargets,
			baseline: 1.5,
			requireBaseline: 1,
			services: ["booklogr-api", "edge-client"],
		});
		assert.equal(res.clean, true);
		assert.deepEqual(res.ambient, ["EdgeClientRequestJitter"]);
		assert.deepEqual(res.outOfScope, []);
	});

	it("25. runQuiesceLoop threads `services` through to classifyPoll", () => {
		// classifyPoll was tested with `services` directly; nothing proved the loop
		// actually forwards it. A dropped pass-through would silently restore the
		// global gate with every unit test still green.
		let polls = 0;
		return runQuiesceLoop({
			fetchPoll: async () => {
				polls++;
				return {
					alerts: [stalledPending],
					targets: healthyTargets,
					baseline: 1.5,
				};
			},
			deadlineS: 60,
			intervalS: 0,
			settle: 2,
			requireBaseline: 1,
			services: ["booklogr-api"],
			sleepFn: async () => {},
			logStderr: false,
			logStdout: false,
		}).then((res) => {
			assert.equal(
				res.ok,
				true,
				"out-of-scope pending must not block the loop",
			);
			assert.equal(polls, 2);
		});
	});

	it("26. the gate's scope agrees with the oracle's for every shipped manifest", () => {
		// Three separate regexes read `services` in this repo. This gate reads the
		// [verify] block; the oracle (run-incident.mjs:161) matches file-wide and
		// double-quotes only. They agree on all shipped manifests today, and this
		// fails loudly if a manifest ever lands in a shape where they disagree —
		// because then the plane could arm clean on an alert the oracle then counts.
		//
		// MIRRORS run-incident.mjs:161 — keep in sync, or delete both once the two
		// callers share one helper (tracked as follow-up).
		const oracleScope = (toml) => {
			const m = toml.match(/^\s*services\s*=\s*\[([^\]]*)\]/m);
			return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
		};

		const scenariosDir = fileURLToPath(
			new URL("../../../../scenarios", import.meta.url),
		);
		const disagreements = [];
		for (const e of readdirSync(scenariosDir, { withFileTypes: true })) {
			const manifest = join(scenariosDir, e.name, "scenario.toml");
			if (!e.isDirectory() || !existsSync(manifest)) continue;
			const gate = readScenarioServices(e.name).services;
			const oracle = oracleScope(readFileSync(manifest, "utf8"));
			if (JSON.stringify(gate) !== JSON.stringify(oracle)) {
				disagreements.push(
					`${e.name}: gate=${JSON.stringify(gate)} oracle=${JSON.stringify(oracle)}`,
				);
			}
		}
		assert.deepEqual(disagreements, [], disagreements.join(" | "));
	});

	it("16. the loop settles through a permanently-firing ambient alert", async () => {
		// The regression guard for #121: a metronome that never stops must not stop
		// the streak. Pre-fix this fetchPoll would reset cleanStreak on every poll
		// and run to QUIESCE_TIMEOUT.
		let polls = 0;
		const res = await runQuiesceLoop({
			fetchPoll: async () => {
				polls++;
				return {
					alerts: [ambientFiring],
					targets: healthyTargets,
					baseline: 1.5,
				};
			},
			deadlineS: 60,
			intervalS: 0,
			settle: 3,
			requireBaseline: 1,
			sleepFn: async () => {},
			logStderr: false,
			logStdout: false,
		});
		assert.equal(res.ok, true);
		assert.equal(res.state, "quiesced");
		assert.equal(polls, 3);
	});
});
