import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	computeMedian,
	evaluateVerdict,
	generateHeadroomMd,
	HeadroomError,
	readScenarioMode,
	REPO_ROOT,
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
	const { runIds } = runCampaign({
		scenario: "/path/to/scenario-xyz",
		runs: 2,
		useCase: "booklogr",
		idPrefix: "hr",
		executor: (args) => {
			calls.push(args);
			return 0;
		},
	});
	assert.deepEqual(runIds, ["hr-scenario-xyz-1", "hr-scenario-xyz-2"]);
	assert.equal(calls.length, 2);
	assert.equal(calls[0].rid, "hr-scenario-xyz-1");
	assert.equal(calls[1].rid, "hr-scenario-xyz-2");
});

test("run-flow with stub executor: cycle 2 of 3 fails -> run_failed row, median over 2", async () => {
	const outDir = tmp();
	mkdirSync(join(outDir, "verify"), { recursive: true });
	const opts = {
		cmd: "run",
		scenario: outDir,
		runs: 3,
		useCase: "booklogr",
		idPrefix: "test",
		mode: "score-headroom",
		threshold: 0.8,
	};
	const mockFinder = (_useCase, _scenarioId, rid) => {
		return {
			record: { score: { score: 0.5 }, verdict: "resolved" },
			recordPath: "fake.json",
			diagnosis: null,
			runDir: "some-dir",
		};
	};
	const { runIds, failedRunIds } = runCampaign({
		scenario: opts.scenario,
		runs: opts.runs,
		useCase: opts.useCase,
		agentCmd: null,
		idPrefix: opts.idPrefix,
		executor: (args) => (args.rid.endsWith("-2") ? 1 : 0),
	});
	opts.runIds = runIds;
	opts.failedRunIds = failedRunIds;
	await scoreSubcommand(opts, mockFinder);

	const mdPath = join(outDir, "verify", "headroom.md");
	assert.ok(existsSync(mdPath));
	const md = readFileSync(mdPath, "utf8");
	assert.match(md, /\| test-.+-2 \| — \| run_failed \|/);
	assert.match(md, /\*\*Mitigation Median\*\*: 0\.5/);
});

test("run-flow with stub executor: all cycles fail -> insufficient-valid-runs verdict", async () => {
	const outDir = tmp();
	mkdirSync(join(outDir, "verify"), { recursive: true });
	const opts = {
		cmd: "run",
		scenario: outDir,
		runs: 2,
		useCase: "booklogr",
		idPrefix: "test",
		mode: "score-headroom",
		threshold: 0.8,
	};
	const mockFinder = () => ({ record: null });
	const { runIds, failedRunIds } = runCampaign({
		scenario: opts.scenario,
		runs: opts.runs,
		useCase: opts.useCase,
		agentCmd: null,
		idPrefix: opts.idPrefix,
		executor: () => 1,
	});
	opts.runIds = runIds;
	opts.failedRunIds = failedRunIds;
	await scoreSubcommand(opts, mockFinder);

	const mdPath = join(outDir, "verify", "headroom.md");
	assert.ok(existsSync(mdPath));
	const md = readFileSync(mdPath, "utf8");
	assert.match(md, /\*\*ERROR\*\* — insufficient valid runs/);
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
		assert.match(err.message, /records\/r1\.json/);
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

// These fixtures deliberately use "decoy-rate" as the expected value. Asserting
// "score-headroom" cannot distinguish a successful parse from the fallback —
// they are the same string — so such a test passes even when the parser is
// completely broken.
test("readScenarioMode: reads the field from the [verify] block", () => {
	const outDir = tmp();
	writeFileSync(
		join(outDir, "scenario.toml"),
		`[identity]\nid = "x"\n\n[verify]\noracle = "mitigation"   # trailing comment\nqualification_mode = "decoy-rate"\npass_threshold = 0.85\n`,
		"utf8",
	);
	assert.equal(readScenarioMode(outDir), "decoy-rate");
});

test("readScenarioMode: accepts a direct scenario.toml path", () => {
	const outDir = tmp();
	writeFileSync(
		join(outDir, "scenario.toml"),
		`[verify]\noracle = "mitigation"\nqualification_mode = "decoy-rate"\n`,
		"utf8",
	);
	assert.equal(readScenarioMode(join(outDir, "scenario.toml")), "decoy-rate");
});

test("readScenarioMode: qualification_mode outside [verify] is ignored", () => {
	const outDir = tmp();
	writeFileSync(
		join(outDir, "scenario.toml"),
		`[identity]\nqualification_mode = "decoy-rate"\n\n[verify]\noracle = "mitigation"\n`,
		"utf8",
	);
	assert.equal(readScenarioMode(outDir), "score-headroom");
});

function captureWarning(needle, fn) {
	let seen = false;
	const orig = process.stderr.write;
	process.stderr.write = (chunk) => {
		if (chunk.toString().includes(needle)) seen = true;
		return true;
	};
	try {
		const out = fn();
		return { out, seen };
	} finally {
		process.stderr.write = orig;
	}
}

test("readScenarioMode: unknown mode warns and falls back", () => {
	const outDir = tmp();
	writeFileSync(
		join(outDir, "scenario.toml"),
		`[verify]\noracle = "mitigation"\nqualification_mode = "score-headrom"\n`,
		"utf8",
	);
	const { out, seen } = captureWarning("unknown qualification_mode", () =>
		readScenarioMode(outDir),
	);
	assert.equal(out, "score-headroom");
	assert.ok(seen, "expected an unknown-mode warning on stderr");
});

test("readScenarioMode: missing field warns and falls back", () => {
	const outDir = tmp();
	writeFileSync(
		join(outDir, "scenario.toml"),
		`[verify]\noracle = "mitigation"\npass_threshold = 0.85\n`,
		"utf8",
	);
	const { out, seen } = captureWarning(
		"qualification_mode field missing",
		() => readScenarioMode(outDir),
	);
	assert.equal(out, "score-headroom");
	assert.ok(seen, "expected a missing-field warning on stderr");
});

test("readScenarioMode: missing manifest warns and falls back", () => {
	const outDir = tmp();
	const { out, seen } = captureWarning("scenario manifest not found", () =>
		readScenarioMode(outDir),
	);
	assert.equal(out, "score-headroom");
	assert.ok(seen, "expected a missing-manifest warning on stderr");
});

test("all 7 shipped scenario manifests parse without warnings", () => {
	const dir = join(REPO_ROOT, "use-cases", "booklogr", "scenarios");
	const names = readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
	assert.ok(names.length >= 7, `expected >=7 scenarios, saw ${names.length}`);
	for (const n of names) {
		const { out, seen } = captureWarning("WARNING", () =>
			readScenarioMode(join(dir, n)),
		);
		assert.ok(!seen, `${n}: manifest emitted a parse warning`);
		assert.equal(out, "score-headroom", `${n}: unexpected mode`);
	}
});
