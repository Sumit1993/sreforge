import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate, readIdentity, readVerdict, classify, collectScenarios, OUTPUT_RELPATH } from "../generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "../generate.mjs");
const REPO_ROOT = resolve(HERE, "../../..");

// Deliberately distinctive digit sequences. If any of these ever appears in the
// rendered page, a private baseline number has leaked into a public artifact.
const FIXTURE_MEDIAN = "0.7314159265358979";
const FIXTURE_THRESHOLD = "0.8271828";
const FIXTURE_RUN_ID = "campaign-fixture-4242";
const SECRET_DIGITS = [FIXTURE_MEDIAN, FIXTURE_THRESHOLD, "4242", "7314159265358979", "8271828"];

// Unique sentinels, one per private surface. Any of them showing up in the
// rendered page means that surface leaked. Distinctive enough that no ordinary
// English in the page template can produce a false positive.
const SENTINELS = {
	title: "TITLESENTINEL",
	description: "DESCRIPTIONSENTINEL",
	oracle: "ORACLESENTINEL",
	solution: "SOLUTIONSENTINEL",
	inject: "INJECTSENTINEL",
};

const TOML = (id, uc = "fixtureuc") => `# scenario.toml — fixture
# --- identity ---
id        = "${id}"                    # BINDING — unique scenario id
use_case  = "${uc}"                    # BINDING
stack     = "flask-compose"            # BINDING
profile   = "incident"                 # ARCHETYPE
title     = "${SENTINELS.title}: cache outage caused by a dropped composite index on the hot read path"
difficulty = "hard"

description = """
${SENTINELS.description} — the authored root cause: a deploy dropped the
(owner_id, lower(title)) composite index and the fix is to recreate it. None of
this may ever reach the public catalog page.
"""

[paths]
stack    = "../../stacks/flask-compose"
`;

const HEADROOM = (verdict, cmp) => `# Baseline Headroom Qualification

**${verdict}** — mitigation median ${FIXTURE_MEDIAN} ${cmp} threshold ${FIXTURE_THRESHOLD}

**Date**: 2026-07-22
**Threshold**: ${FIXTURE_THRESHOLD}

| Run ID | Mitigation Score |
|---|---|
| ${FIXTURE_RUN_ID} | ${FIXTURE_MEDIAN} |

**Mitigation Median**: ${FIXTURE_MEDIAN}
`;

const ORACLE = `# Oracle rubric\n\n${SENTINELS.oracle} — award full credit only if the agent recreates the dropped composite index.\n`;

/**
 * Build a throwaway repo-shaped root with the given scenarios.
 * @param {Array<{id: string, headroom?: string}>} scenarios
 */
function makeRoot(scenarios) {
	const root = mkdtempSync(join(tmpdir(), "catalog-gen-"));
	for (const s of scenarios) {
		const dir = join(root, "use-cases", "fixtureuc", "scenarios", s.id);
		mkdirSync(join(dir, "verify"), { recursive: true });
		mkdirSync(join(dir, "solution"), { recursive: true });
		mkdirSync(join(dir, "inject"), { recursive: true });
		writeFileSync(join(dir, "scenario.toml"), TOML(s.id));
		writeFileSync(join(dir, "verify", "oracle.md"), ORACLE);
		writeFileSync(join(dir, "solution", "fix.patch"), `${SENTINELS.solution} recreate the dropped composite index\n`);
		writeFileSync(join(dir, "inject", "break.sh"), `${SENTINELS.inject} drop index idx_books_owner_title\n`);
		if (s.headroom) writeFileSync(join(dir, "verify", "headroom.md"), s.headroom);
	}
	return root;
}

test("emits an exact row for a DISQUALIFIED scenario", () => {
	const root = makeRoot([{ id: "fixture-scenario", headroom: HEADROOM("DISQUALIFIED", ">=") }]);
	try {
		const page = generate(root);
		const rows = page.split("\n").filter(l => l.startsWith("| [") );
		assert.equal(rows.length, 1);
		assert.equal(
			rows[0],
			"| [fixture-scenario](https://github.com/prismalens/sreforge/tree/main/use-cases/fixtureuc/scenarios/fixture-scenario) | fixtureuc | incident | regression-guard / CI-smoke | DISQUALIFIED |",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("QUALIFIED maps to the certification-substrate role", () => {
	const root = makeRoot([{ id: "fixture-qualified", headroom: HEADROOM("QUALIFIED", "<") }]);
	try {
		const page = generate(root);
		assert.match(page, /\| fixtureuc \| incident \| certification-substrate \| QUALIFIED \|/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("LEAKAGE: no digit sequence from headroom.md reaches the page", () => {
	const root = makeRoot([
		{ id: "fixture-a", headroom: HEADROOM("DISQUALIFIED", ">=") },
		{ id: "fixture-b", headroom: HEADROOM("QUALIFIED", "<") },
	]);
	try {
		const page = generate(root);
		for (const digits of SECRET_DIGITS) {
			assert.ok(!page.includes(digits), `private number ${digits} leaked into the catalog page`);
		}
		// Nothing numeric at all: the page carries no digit whatsoever. `*` not
		// `+`, matching the committed-page assertion at the bottom of this file —
		// real headroom reports carry lone single digits (`**Diagnosis Median**: 1`),
		// and a pattern requiring two characters would miss exactly those leaks.
		const numeric = page.match(/\d[\d.]*/g) ?? [];
		assert.deepEqual(numeric, [], `page contains numeric tokens: ${numeric.join(", ")}`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("LEAKAGE: no oracle, solution, inject, title or description wording reaches the page", () => {
	const root = makeRoot([{ id: "fixture-scenario", headroom: HEADROOM("DISQUALIFIED", ">=") }]);
	try {
		const page = generate(root);
		for (const [surface, sentinel] of Object.entries(SENTINELS)) {
			assert.ok(!page.includes(sentinel), `${surface} content leaked into the catalog page`);
		}
		const lower = page.toLowerCase();
		// NOTE: "root cause" and "oracle rubric" are deliberately absent from this
		// list. The intro paragraph must state that authored root causes and oracle
		// rubrics are private — naming the categories is the point; naming a given
		// scenario's root cause or reproducing its rubric is the leak, and the
		// sentinels above are what catch that.
		for (const forbidden of ["composite index", "owner_id", "cache outage", "idx_books", "recreate"]) {
			assert.ok(!lower.includes(forbidden), `forbidden wording "${forbidden}" leaked into the catalog page`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing headroom.md yields a pending-qualification row", () => {
	const root = makeRoot([{ id: "fixture-pending" }]);
	try {
		const page = generate(root);
		assert.match(page, /\| pending qualification \| unqualified \(no headroom run\) \|/);
		// The uppercase verdict words must not appear for an unqualified scenario —
		// the CI row count greps for exactly those. Bind the row first: `.find()`
		// returns undefined when nothing matches, and RegExp.test(undefined) tests
		// the string "undefined", so an unbound check would quietly pass if the row
		// ever stopped being emitted.
		const row = page.split("\n").find(l => l.includes("fixture-pending"));
		assert.ok(row, "expected a rendered row for fixture-pending");
		assert.ok(!/QUALIFIED/.test(row), `pending row must not carry a verdict word: ${row}`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

/** @param {string} page */
function rowIds(page) {
	return page
		.split("\n")
		.filter(l => l.startsWith("| ["))
		.map(l => l.slice(3, l.indexOf("]")));
}

test("row order is code-unit, not locale collation (--check compares bytes)", () => {
	// The cheapest case where localeCompare and code-unit order disagree: locale
	// collation treats `-` and `_` as variable-weight and yields a_b, a-b, ab;
	// code-unit order is a-b, a_b, ab. Pinning the latter keeps the generated
	// page identical across locales and ICU builds, which is what makes the
	// byte-comparing --check gate trustworthy.
	const ids = ["ab", "a-b", "a_b"];
	const root = makeRoot(ids.map(id => ({ id })));
	try {
		assert.deepEqual(rowIds(generate(root)), ["a-b", "a_b", "ab"]);
		assert.notDeepEqual([...ids].sort((a, b) => a.localeCompare(b)), ["a-b", "a_b", "ab"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rows are sorted by use-case then scenario id", () => {
	const root = makeRoot([{ id: "zeta" }, { id: "alpha" }, { id: "mid" }]);
	try {
		assert.deepEqual(rowIds(generate(root)), ["alpha", "mid", "zeta"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readVerdict takes the FIRST bold verdict only", () => {
	assert.equal(readVerdict("# x\n\n**QUALIFIED** — a\n\n**DISQUALIFIED** — b\n"), "QUALIFIED");
	assert.equal(readVerdict("no verdict here"), null);
});

test("classify covers all three states", () => {
	assert.deepEqual(classify("QUALIFIED"), { status: "QUALIFIED", role: "certification-substrate" });
	assert.deepEqual(classify("DISQUALIFIED"), { status: "DISQUALIFIED", role: "regression-guard / CI-smoke" });
	assert.deepEqual(classify(null), { status: "unqualified (no headroom run)", role: "pending qualification" });
});

test("a non-identifier identity value is rejected rather than published", () => {
	const bad = 'id = "x"\nuse_case = "u"\nstack = "s"\nprofile = "incident | evil"\n';
	assert.throws(() => readIdentity(bad, "bad.toml"), /not a bare identifier/);
});

test("a digit-bearing identity value is rejected at generation time, naming the manifest and field", () => {
	// SAFE_TOKEN alone would accept `postgres-15`, which would silently put digits
	// on the page and turn the committed-page zero-digit assertion into a confusing
	// failure far from its cause. This check fails first, and says where.
	const bad = 'id = "postgres-15"\nuse_case = "u"\nstack = "s"\nprofile = "incident"\n';
	assert.throws(() => readIdentity(bad, "use-cases/u/scenarios/postgres-15/scenario.toml"), {
		message: /use-cases\/u\/scenarios\/postgres-15\/scenario\.toml: identity field 'id' = "postgres-15" contains a digit/,
	});
	// Every allowlisted field is covered, not just id.
	assert.throws(() => readIdentity('id = "a"\nuse_case = "u"\nstack = "flask-compose-v2"\nprofile = "incident"\n', "t.toml"), {
		message: /identity field 'stack' .* contains a digit/,
	});
});

test("an unknown profile is a hard error", () => {
	const bad = 'id = "x"\nuse_case = "u"\nstack = "s"\nprofile = "freeform"\n';
	assert.throws(() => readIdentity(bad, "bad.toml"), /unknown profile/);
});

test("identity reads the preamble, not a later [paths] stack", () => {
	const identity = readIdentity(TOML("fixture-scenario"), "t.toml");
	assert.equal(identity.stack, "flask-compose");
	assert.equal(identity.profile, "incident");
	assert.deepEqual(Object.keys(identity).sort(), ["id", "profile", "stack", "use_case"]);
});

test("a manifest id that disagrees with its directory name is a hard error", () => {
	const root = makeRoot([{ id: "fixture-scenario" }]);
	try {
		const p = join(root, "use-cases", "fixtureuc", "scenarios", "fixture-scenario", "scenario.toml");
		writeFileSync(p, TOML("something-else"));
		assert.throws(() => collectScenarios(root), /does not match its directory name/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// --- --check mode ------------------------------------------------------------

function runScript(args, opts = {}) {
	return execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", ...opts });
}

test("--check passes against the committed page", () => {
	const out = runScript(["--check"]);
	assert.match(out, /up to date/);
});

test("--check detects drift and names the regen command", () => {
	// Work on a copy of the committed page so the real one is never disturbed.
	const outPath = join(REPO_ROOT, OUTPUT_RELPATH);
	const original = readFileSync(outPath, "utf8");
	writeFileSync(outPath, original + "\nstale hand edit\n");
	try {
		let failed = false;
		try {
			runScript(["--check"], { stdio: "pipe" });
		} catch (err) {
			failed = true;
			assert.match(String(err.stderr), /DRIFT/);
			assert.match(String(err.stderr), /pnpm catalog:gen/);
			assert.equal(err.status, 1);
		}
		assert.ok(failed, "expected --check to exit non-zero on drift");
	} finally {
		writeFileSync(outPath, original);
	}
});

test("regenerating the committed page is a no-op (generator is deterministic)", () => {
	const outPath = join(REPO_ROOT, OUTPUT_RELPATH);
	const before = readFileSync(outPath, "utf8");
	assert.equal(generate(REPO_ROOT), before);
	// twice, same bytes
	assert.equal(generate(REPO_ROOT), generate(REPO_ROOT));
});

test("LEAKAGE: no number from any real headroom.md appears in the committed page", () => {
	const page = readFileSync(join(REPO_ROOT, OUTPUT_RELPATH), "utf8");
	const numeric = page.match(/\d[\d.]*/g) ?? [];
	assert.deepEqual(numeric, [], `committed page contains numeric tokens: ${numeric.join(", ")}`);
});
