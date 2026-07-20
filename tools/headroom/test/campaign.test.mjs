import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	computeMedian,
	evaluateVerdict,
	generateHeadroomMd,
	HeadroomError,
	runCampaign,
	scoreSubcommand,
} from "../campaign.mjs";

function tmp() {
	const d = join(
		tmpdir(),
		`headroom-test-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

test("computeMedian: odd counts", () => {
	assert.equal(computeMedian([0.1, 0.9, 0.2]), 0.2);
});

test("computeMedian: even counts", () => {
	assert.equal(computeMedian([0.4, 0.2, 0.8, 0.6]), 0.5);
});

test("computeMedian: run_failed exclusion / non-numbers", () => {
	assert.equal(computeMedian([0.1, null, "run_failed", 0.3]), 0.2);
});

test("computeMedian: all-failed", () => {
	assert.equal(computeMedian([null, null]), null);
});

test("evaluateVerdict: score-headroom exact threshold", () => {
	const r = evaluateVerdict({
		mitigationMedian: 0.8,
		mode: "score-headroom",
		threshold: 0.8,
	});
	assert.equal(r.verdict, "DISQUALIFIED");
	assert.match(r.reason, />= threshold/);
});

test("evaluateVerdict: score-headroom below threshold", () => {
	const r = evaluateVerdict({
		mitigationMedian: 0.79,
		mode: "score-headroom",
		threshold: 0.8,
	});
	assert.equal(r.verdict, "QUALIFIED");
	assert.match(r.reason, /< threshold/);
});

test("evaluateVerdict: all-failed -> error verdict", () => {
	const r = evaluateVerdict({
		mitigationMedian: null,
		mode: "score-headroom",
		threshold: 0.8,
	});
	assert.equal(r.verdict, "ERROR");
	assert.match(r.reason, /insufficient valid runs/);
});

test("evaluateVerdict: decoy-rate 0/3 -> DISQUALIFIED", () => {
	const r = evaluateVerdict({ decoyRate: "0/3", mode: "decoy-rate" });
	assert.equal(r.verdict, "DISQUALIFIED");
	assert.match(r.reason, /baseline never falls/);
});

test("evaluateVerdict: decoy-rate 1/3 -> QUALIFIED", () => {
	const r = evaluateVerdict({ decoyRate: "1/3", mode: "decoy-rate" });
	assert.equal(r.verdict, "QUALIFIED");
});

test("evaluateVerdict: decoy-rate no diagnoses -> DISQUALIFIED explicit", () => {
	const r = evaluateVerdict({ decoyRate: null, mode: "decoy-rate" });
	assert.equal(r.verdict, "DISQUALIFIED");
	assert.match(r.reason, /no diagnosis available/);
});

test("run orchestration with injected stub executor", () => {
	const calls = [];
	const runIds = runCampaign({
		scenario: "/path/to/scenario-xyz",
		runs: 2,
		useCase: "booklogr",
		idPrefix: "hr",
		executor: (args) => calls.push(args),
	});
	assert.deepEqual(runIds, ["hr-scenario-xyz-1", "hr-scenario-xyz-2"]);
	assert.equal(calls.length, 2);
	assert.equal(calls[0].rid, "hr-scenario-xyz-1");
	assert.equal(calls[1].rid, "hr-scenario-xyz-2");
});

test("scoreSubcommand: missing record -> clear error", async () => {
	const opts = {
		scenario: "my-scenario",
		runIds: ["r1"],
		mode: "score-headroom",
		threshold: 0.8,
	};
	try {
		await scoreSubcommand(opts, () => ({ record: null }));
		assert.fail("Should have thrown HeadroomError");
	} catch (err) {
		assert.ok(err instanceof HeadroomError);
		assert.match(err.message, /Missing record for run r1/);
	}
});

test("scoreSubcommand: missing diagnosis.json tolerated", async () => {
	const outDir = tmp();
	const opts = {
		scenario: outDir,
		runIds: ["r1"],
		mode: "score-headroom",
		threshold: 0.8,
	};
	const mockFinder = (_useCase, _scenarioId, _runId) => {
		return {
			record: { score: { score: 0.5 }, verdict: "resolved" },
			recordPath: "r1.json",
			diagnosis: null,
			runDir: "some-dir",
		};
	};

	await scoreSubcommand(opts, mockFinder);

	const mdPath = join(outDir, "verify", "headroom.md");
	assert.ok(existsSync(mdPath));
	const md = readFileSync(mdPath, "utf8");
	assert.match(md, /QUALIFIED/);
	assert.match(md, /Diagnosis Median\*\*: —/); // missing diagnosis -> fallback
});

test("headroom.md rendering: golden-ish assertions", () => {
	const md = generateHeadroomMd({
		date: "2026-07-20",
		driver: "my-driver",
		judgeModel: "test-model",
		threshold: 0.8,
		mode: "score-headroom",
		verdict: "QUALIFIED",
		reason: "median 0.5 < threshold 0.8",
		rows: [
			{
				runId: "r1",
				mitigationScore: 0.5,
				verdict: "resolved",
				diagnosisScore: 1.0,
				falseLeads: false,
				failed: false,
			},
			{ runId: "r2", failed: true },
		],
		mitigationMedian: 0.5,
		diagnosisMedian: 1.0,
		decoyRate: "0/1",
	});

	assert.match(md, /# Baseline Headroom Qualification/);
	assert.match(md, /\*\*QUALIFIED\*\* — median 0\.5 < threshold 0\.8/);
	assert.match(md, /\| r1 \| 0\.5 \| resolved \| 1 \| false \|/);
	assert.match(md, /\| r2 \| — \| run_failed \| — \| — \|/);
	assert.match(md, /\*\*Mitigation Median\*\*: 0\.5/);
	assert.match(md, /\*\*Diagnosis Median\*\*: 1/);
	assert.match(md, /\*\*Falls-for-decoy Rate\*\*: 0\/1/);
});
