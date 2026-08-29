// lint.test.mjs — tests for rules-lint (#76)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AMBIENT_SERVICE,
	checkAmbientRoleConsistency,
	checkUnscopedAmbientService,
	DEFAULT_TARGETS,
	extractAlertLabels,
	lintContent,
	lintRules,
	resolveTargets,
} from "../lint.mjs";

const CLI_PATH = fileURLToPath(new URL("../lint.mjs", import.meta.url));

test("all-labelled fixture returns [] from lintContent", () => {
	const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: TestAlert
        expr: up == 0
        labels:
          severity: critical
          service: test-service
`;
	const stats = { totalAlerts: 0 };
	const result = lintContent(yaml, "test.yml", stats);
	assert.deepEqual(result, []);
	assert.equal(stats.totalAlerts, 1);
});

test("missing-label fixture returns failure object", () => {
	const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: MissingService
        expr: up == 0
        labels:
          severity: warning
`;
	const stats = { totalAlerts: 0 };
	const result = lintContent(yaml, "bad.yml", stats);
	assert.equal(result.length, 1);
	assert.equal(result[0].alert, "MissingService");
	assert.equal(result[0].line, 5);
	assert.equal(result[0].file, "bad.yml");
	assert.equal(stats.totalAlerts, 1);
});

test("empty-value fixture treated as missing", () => {
	const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: EmptyService
        expr: up == 0
        labels:
          severity: warning
          service:
`;
	const stats = { totalAlerts: 0 };
	const result = lintContent(yaml, "empty.yml", stats);
	assert.equal(result.length, 1);
	assert.equal(result[0].alert, "EmptyService");
	assert.equal(result[0].line, 5);
	assert.equal(stats.totalAlerts, 1);
});

test("real live rule files all pass", () => {
	// The served copy is a gitignored build artifact present only after an arm;
	// exclude it so the exact file and alert counts stay deterministic.
	const files = resolveTargets(DEFAULT_TARGETS).filter(
		(f) => !f.endsWith("observability/rules/ambient-rules.yml"),
	);
	assert.equal(files.length, 3);
	const stats = { totalAlerts: 0 };
	const failures = lintRules(files, stats);
	assert.deepEqual(failures, []);
	assert.equal(stats.totalAlerts, 6);
});

test("CLI exit 0 on all-labelled fixture", () => {
	const tmpDir = join(tmpdir(), `rules-lint-test-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	const file = join(tmpDir, "good.yml");
	writeFileSync(
		file,
		`groups:\n  - name: g.rules\n    rules:\n      - alert: Good\n        expr: up == 0\n        labels:\n          service: s1\n`,
	);
	try {
		const stdout = execFileSync("node", [CLI_PATH, file], { encoding: "utf8" });
		assert.match(
			stdout,
			/rules-lint: OK — 1 alert\(s\) across 1 file\(s\), all carry a service label/,
		);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("CLI exit 1 on missing-label fixture", () => {
	const tmpDir = join(tmpdir(), `rules-lint-test-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	const file = join(tmpDir, "bad.yml");
	writeFileSync(
		file,
		`groups:\n  - name: b.rules\n    rules:\n      - alert: Bad\n        expr: up == 0\n        labels:\n          severity: warning\n`,
	);
	try {
		assert.throws(
			() => execFileSync("node", [CLI_PATH, file], { encoding: "utf8" }),
			(err) => {
				assert.equal(err.status, 1);
				assert.match(
					err.stderr,
					/rules-lint: FAIL — .*bad\.yml:4 alert "Bad" has no service label/,
				);
				assert.match(
					err.stderr,
					/rules-lint: FAIL — 1 of 1 alert\(s\) missing a service label/,
				);
				return true;
			},
		);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("annotation-only service fixture fails lint", () => {
	const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: AnnotationOnlyService
        expr: up == 0
        annotations:
          summary: Alert summary
          service: annotation-service
`;
	const stats = { totalAlerts: 0 };
	const result = lintContent(yaml, "annotation_only.yml", stats);
	assert.equal(result.length, 1);
	assert.equal(result[0].alert, "AnnotationOnlyService");
	assert.equal(stats.totalAlerts, 1);
});

test("quoted-empty service fixture fails lint", () => {
	const yamlDouble = `
groups:
  - name: test.rules
    rules:
      - alert: QuotedDoubleEmpty
        expr: up == 0
        labels:
          service: ""
`;
	const yamlSingle = `
groups:
  - name: test.rules
    rules:
      - alert: QuotedSingleEmpty
        expr: up == 0
        labels:
          service: ''
`;
	assert.equal(lintContent(yamlDouble, "double.yml").length, 1);
	assert.equal(lintContent(yamlSingle, "single.yml").length, 1);
});

test("null or tilde service fixture fails lint", () => {
	const yamlNull = `
groups:
  - name: test.rules
    rules:
      - alert: NullService
        expr: up == 0
        labels:
          service: null
`;
	const yamlTilde = `
groups:
  - name: test.rules
    rules:
      - alert: TildeService
        expr: up == 0
        labels:
          service: ~
`;
	assert.equal(lintContent(yamlNull, "null.yml").length, 1);
	assert.equal(lintContent(yamlTilde, "tilde.yml").length, 1);
});

test("following recording rule labels do not satisfy alert service requirement", () => {
	const yaml = `
groups:
  - name: test.rules
    rules:
      - alert: AlertWithoutService
        expr: up == 0
        labels:
          severity: critical
      - record: job:up:count
        expr: count(up)
        labels:
          service: recording-service
`;
	const stats = { totalAlerts: 0 };
	const result = lintContent(yaml, "recording_rule.yml", stats);
	assert.equal(result.length, 1);
	assert.equal(result[0].alert, "AlertWithoutService");
	assert.equal(stats.totalAlerts, 1);
});

test("resolveTargets respects wildcard glob patterns and extensions", () => {
	const tmpDir = join(tmpdir(), `rules-lint-glob-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	writeFileSync(join(tmpDir, "rule-a.yml"), "content");
	writeFileSync(join(tmpDir, "rule-b.yaml"), "content");
	writeFileSync(join(tmpDir, "subset-c.yml"), "content");
	writeFileSync(join(tmpDir, "other.txt"), "content");

	try {
		const ymlOnly = resolveTargets([join(tmpDir, "*.yml")]);
		assert.deepEqual(ymlOnly, [
			join(tmpDir, "rule-a.yml"),
			join(tmpDir, "subset-c.yml"),
		]);

		const subsetOnly = resolveTargets([join(tmpDir, "subset-*.yml")]);
		assert.deepEqual(subsetOnly, [join(tmpDir, "subset-c.yml")]);

		const yamlOnly = resolveTargets([join(tmpDir, "*.yaml")]);
		assert.deepEqual(yamlOnly, [join(tmpDir, "rule-b.yaml")]);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("checkUnscopedAmbientService asserts edge-client is unscoped across real scenarios", () => {
	const result = checkUnscopedAmbientService(
		"use-cases/booklogr/scenarios",
		"edge-client",
	);
	assert.equal(result.count, 7);
	assert.deepEqual(result.errors, []);
});

test("checkUnscopedAmbientService ignores services key in non-verify sections", () => {
	const tmpDir = join(tmpdir(), `rules-lint-unscoped-${Date.now()}`);
	const scenarioDir = join(tmpDir, "test-scenario");
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "scenario.toml"),
		`[meta]\nservices = ["edge-client"]\n\n[verify]\nservices = ["booklogr-api"]\n`,
	);
	try {
		const result = checkUnscopedAmbientService(tmpDir, "edge-client");
		assert.equal(result.count, 1);
		assert.deepEqual(result.errors, []);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ── #121: `role: ambient` and the ambient service must agree ─────────────────
// confirm-quiesced exempts `role: ambient` alerts from its firing/pending
// assertion, so the label has to mean exactly one thing in both directions.

const AMBIENT_RULE = `groups:
  - name: edge_telemetry
    rules:
      - alert: EdgeClientRequestJitter
        expr: vector(time()) % 120 < 60
        labels:
          severity: warning
          service: edge-client
          role: ambient
`;

function withRulesFile(content, fn) {
	const tmpDir = join(tmpdir(), `rules-lint-role-${process.hrtime.bigint()}`);
	mkdirSync(tmpDir, { recursive: true });
	const file = join(tmpDir, "rules.yml");
	writeFileSync(file, content);
	try {
		return fn(file);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

test("extractAlertLabels reads both service and role from the labels block", () => {
	const got = extractAlertLabels(AMBIENT_RULE, "rules.yml");
	assert.equal(got.length, 1);
	assert.equal(got[0].alert, "EdgeClientRequestJitter");
	assert.equal(got[0].service, "edge-client");
	assert.equal(got[0].role, "ambient");
});

test("extractAlertLabels ignores a role key outside the labels block", () => {
	// `role:` under annotations must not be read as a label — that would let an
	// annotation silently exempt a rule from the quiesce gate.
	const got = extractAlertLabels(
		`groups:
  - name: g
    rules:
      - alert: A
        expr: up
        labels:
          service: booklogr-api
        annotations:
          role: ambient
`,
		"rules.yml",
	);
	assert.equal(got.length, 1);
	assert.equal(got[0].service, "booklogr-api");
	assert.equal(got[0].role, null);
});

test("checkAmbientRoleConsistency passes on a correctly-labelled ambient rule", () => {
	withRulesFile(AMBIENT_RULE, (file) => {
		const res = checkAmbientRoleConsistency([file], "edge-client");
		assert.equal(res.count, 1);
		assert.deepEqual(res.errors, []);
	});
});

test("checkAmbientRoleConsistency FAILS an ambient-service rule with no role label", () => {
	withRulesFile(
		AMBIENT_RULE.replace("          role: ambient\n", ""),
		(file) => {
			const res = checkAmbientRoleConsistency([file], "edge-client");
			assert.equal(res.errors.length, 1);
			assert.match(res.errors[0], /has no `role: ambient` label/);
		},
	);
});

test("checkAmbientRoleConsistency FAILS a non-ambient rule that claims role: ambient", () => {
	withRulesFile(
		AMBIENT_RULE.replace("service: edge-client", "service: booklogr-api"),
		(file) => {
			const res = checkAmbientRoleConsistency([file], "edge-client");
			assert.equal(res.errors.length, 1);
			assert.match(
				res.errors[0],
				/must not exempt itself from the quiesce gate/,
			);
		},
	);
});

test("checkAmbientRoleConsistency holds on the shipped rules files", () => {
	const shipped = resolveTargets(DEFAULT_TARGETS);
	const res = checkAmbientRoleConsistency(shipped, "edge-client");
	assert.deepEqual(res.errors, []);
	assert.ok(res.count >= 1, "expected at least one ambient rule in the stack");
});

// ── Regression guards for the two defects found in review of PR #122 ──────────

test("checkUnscopedAmbientService CAN fail — the invariant is not vacuous", () => {
	// This is the test whose absence let a broken regex print "Invariant passed"
	// while inspecting only the first key line of the [verify] block. `services`
	// deliberately sits BELOW another key, which is the case the old /m regex missed.
	const tmpDir = join(
		tmpdir(),
		`rules-lint-vacuous-${process.hrtime.bigint()}`,
	);
	const scenarioDir = join(tmpDir, "bad-scenario");
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "scenario.toml"),
		`[meta]\nname = "bad"\n\n[verify]\noracle = "mitigation"\npass_threshold = 0.85\nservices = ["booklogr-api", "edge-client"]\n\n[weights]\nci_green = 0.2\n`,
	);
	try {
		const result = checkUnscopedAmbientService(tmpDir, "edge-client");
		assert.equal(result.count, 1);
		assert.equal(
			result.errors.length,
			1,
			"a scenario declaring the ambient service MUST be rejected",
		);
		assert.match(result.errors[0], /includes ambient service 'edge-client'/);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("checkUnscopedAmbientService sees a services key on any line of [verify]", () => {
	// Single-quoted, and last key in the block — both previously invisible.
	const tmpDir = join(tmpdir(), `rules-lint-quoted-${process.hrtime.bigint()}`);
	const scenarioDir = join(tmpDir, "s");
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "scenario.toml"),
		`[verify]\noracle = "mitigation"\nservices = ['edge-client']\n`,
	);
	try {
		const result = checkUnscopedAmbientService(tmpDir, "edge-client");
		assert.equal(result.errors.length, 1);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("the authoritative ambient rule carries role: ambient", () => {
	// The served copy is an untracked build artifact produced by a plain `cp` from
	// furniture/ambient-rules.yml in arm-regress.sh, carrying the label by
	// construction; labelling the authoritative copy is what matters (#121).
	const stack = fileURLToPath(
		new URL(
			"../../../use-cases/booklogr/stacks/flask-compose/",
			import.meta.url,
		),
	);
	for (const rel of ["furniture/ambient-rules.yml"]) {
		const alerts = extractAlertLabels(
			readFileSync(join(stack, rel), "utf8"),
			rel,
		);
		const ambient = alerts.filter((a) => a.service === AMBIENT_SERVICE);
		assert.ok(ambient.length >= 1, `${rel}: expected an ambient-service alert`);
		for (const a of ambient) {
			assert.equal(
				a.role,
				"ambient",
				`${rel}: alert "${a.alert}" is missing role: ambient`,
			);
		}
	}
});

test("the default lint targets cover the furniture dir", () => {
	// If furniture/*.yml leaves the default target set, the guard above stops
	// running in CI (which invokes the CLI with no arguments).
	const files = resolveTargets(DEFAULT_TARGETS);
	assert.ok(
		files.some((f) => f.includes("furniture/ambient-rules.yml")),
		"furniture/ambient-rules.yml must be linted",
	);
	const res = checkAmbientRoleConsistency(files, AMBIENT_SERVICE);
	assert.deepEqual(res.errors, []);
	assert.ok(res.count >= 1, `expected >=1 ambient rules, got ${res.count}`);
});
