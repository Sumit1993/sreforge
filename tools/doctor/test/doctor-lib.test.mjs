import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	classifyHijack,
	classifyRunnerError,
	classifyWincred,
	containerExists,
	defineChecks,
	diffEnvKeys,
	getStartError,
	isRunning,
	resolveRepoRoot,
	runAllChecks,
	summarize,
} from "../lib.mjs";

test("classifyHijack", () => {
	assert.equal(
		classifyHijack({ status: 200 }, { status: 401 }),
		"hijacked-proxy",
	);
	assert.equal(
		classifyHijack({ status: 200 }, { status: 200, json: { version: "1.0" } }),
		"healthy",
	);
	assert.equal(
		classifyHijack(
			{ status: 401 },
			{ status: 401, json: { message: "Unauthorized" } },
		),
		"healthy",
	);
	assert.equal(
		classifyHijack(
			{ status: 401 },
			{ status: 401, headers: { "set-cookie": "i_like_gitea" } },
		),
		"healthy",
	);
	assert.equal(
		classifyHijack({ status: 401 }, { status: 401, json: {}, headers: {} }),
		"down",
	);
	assert.equal(classifyHijack({ status: null }, { status: null }), "down");

	assert.equal(
		classifyHijack(
			{ status: 403 },
			{
				status: 403,
				json: { message: "Only signed in user is allowed to call APIs." },
			},
		),
		"healthy",
	);
	assert.equal(
		classifyHijack({ status: 403 }, { status: 404, json: {} }),
		"hijacked-proxy",
	);
	assert.equal(
		classifyHijack({ status: 403 }, { status: 403, json: {}, headers: {} }),
		"down",
	);
});

test("resolveRepoRoot", () => {
	const fakeUsecase = resolve("/fake/repo/use-cases/booklogr");
	assert.equal(resolveRepoRoot(fakeUsecase), resolve("/fake/repo"));
});

test("classifyRunnerError", () => {
	assert.equal(
		classifyRunnerError(
			"OCI runtime create failed: ... docker-mounts ... not a directory",
		),
		"stale-shim",
	);
	assert.equal(classifyRunnerError("some other error"), "other");
});

test("classifyWincred", () => {
	assert.equal(
		classifyWincred(
			"error: docker-credential-wincred.exe ... exec format error",
		),
		"interop-broken",
	);
	assert.equal(classifyWincred("some other error"), "other");
});

test("diffEnvKeys", () => {
	assert.deepEqual(diffEnvKeys("FOO=1\nBAR=2", "FOO=1"), ["BAR"]);
	assert.deepEqual(diffEnvKeys("FOO=1", "FOO=1\nBAZ=3"), []);
	assert.deepEqual(diffEnvKeys("FOO=1\nBAR=2", ""), ["FOO", "BAR"]);
	assert.deepEqual(diffEnvKeys("FOO = 1\nBAR=2", "FOO=1\nBAR = 2"), []);
});

test("summarize", () => {
	const allPass = [
		{ plane: "core", id: "check1", status: "pass", detail: "ok" },
	];
	assert.equal(summarize(allPass).exitCode, 0);
	assert.equal(summarize(allPass).lines[0], "PASS core/check1 — ok");

	const someWarn = [
		{ plane: "core", id: "check1", status: "warn", detail: "hm" },
	];
	assert.equal(summarize(someWarn).exitCode, 0);

	const someFail = [
		{ plane: "core", id: "check1", status: "fail", detail: "bad" },
		{ plane: "core", id: "check2", status: "pass", detail: "ok" },
	];
	const { exitCode, lines } = summarize(someFail);
	assert.equal(exitCode, 1);
	assert.equal(lines.length, 2);
	assert.equal(lines[0], "FAIL core/check1 — bad");
});

test("bootstrap-env check missing example env", async () => {
	const checks = defineChecks({
		exampleEnvPath: "/does/not/exist/.env.example",
		envPath: "/does/not/exist/.env",
	});
	const check = checks.find((c) => c.id === "bootstrap-env");
	const res = await check.run();
	assert.equal(res.status, "fail");
	assert.match(res.detail, /\.env\.example missing or unreadable/);
});

test("runAllChecks", async () => {
	const checks = [
		{
			id: "c1",
			plane: "p",
			run: async () => ({ status: "pass", detail: "ok" }),
		},
		{
			id: "c2",
			plane: "p",
			run: async () => {
				throw new Error("boom");
			},
		},
		{
			id: "c3",
			plane: "p",
			run: async () => ({ status: "pass", detail: "ok" }),
		},
	];
	const res = await runAllChecks(checks);
	assert.equal(res.length, 3);
	assert.equal(res[1].status, "fail");
	assert.equal(res[1].detail, "boom");
});

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("compose drift: DEPLOY_SERVICES matches docker-compose.yml container names", async () => {
	const libUrl = new URL(
		"../../../use-cases/booklogr/stacks/flask-compose/scripts/lib.mjs",
		import.meta.url,
	);
	const { DEPLOY_SERVICES } = await import(libUrl);
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const composePath = resolve(
		__dirname,
		"../../../use-cases/booklogr/stacks/flask-compose/compose/docker-compose.yml",
	);
	const composeText = readFileSync(composePath, "utf8");

	const parsedServices = [];
	for (const line of composeText.split("\n")) {
		const match = line.match(/^\s*container_name:\s*([^\s]+)/);
		if (match) {
			parsedServices.push(match[1]);
		}
	}

	assert.deepEqual(
		parsedServices.sort(),
		[...DEPLOY_SERVICES].sort(),
		"DEPLOY_SERVICES must exactly match container_names in compose file",
	);
});

test("dockerInspect helpers", () => {
	const fakeExecFormat = (cmd, args, opts) => {
		assert.equal(cmd, "docker");
		assert.equal(opts.timeout, 5000);
		if (args.includes("running-container")) return "true\n";
		if (args.includes("stopped-container")) return "false\n";
		if (args.includes("error-container")) return "some-error\n";
		throw new Error("not found");
	};

	assert.equal(isRunning("running-container", { _exec: fakeExecFormat }), true);
	assert.equal(
		isRunning("stopped-container", { _exec: fakeExecFormat }),
		false,
	);
	assert.equal(
		isRunning("missing-container", { _exec: fakeExecFormat }),
		false,
	);

	const fakeExecNoFormat = (cmd, args, _opts) => {
		assert.equal(cmd, "docker");
		assert.equal(args[0], "inspect");
		if (args.includes("missing-container")) throw new Error("not found");
		return ""; // execFileSync returns stdout but we ignore it
	};

	assert.equal(
		containerExists("running-container", { _exec: fakeExecNoFormat }),
		true,
	);
	assert.equal(
		containerExists("missing-container", { _exec: fakeExecNoFormat }),
		false,
	);

	assert.equal(
		getStartError("error-container", { _exec: fakeExecFormat }),
		"some-error",
	);
});

test("observability-quiescence check handling non-array alerts payload and malformed entries", async () => {
	const originalFetch = globalThis.fetch;
	try {
		// Non-array payload test
		globalThis.fetch = async () => ({
			status: 200,
			ok: true,
			headers: new Map(),
			json: async () => ({
				status: "success",
				data: { alerts: "not-an-array" },
			}),
		});
		const checks1 = defineChecks({ prometheusUrl: "http://localhost:9090" });
		const quiesceCheck1 = checks1.find(
			(c) => c.id === "observability-quiescence",
		);
		const res1 = await quiesceCheck1.run();
		assert.equal(res1.status, "warn");
		assert.equal(res1.detail, "prometheus returned malformed alerts payload");

		// Malformed alert entries & default <use-case> hint
		globalThis.fetch = async () => ({
			status: 200,
			ok: true,
			headers: new Map(),
			json: async () => ({
				status: "success",
				data: {
					alerts: [null, 123, { state: "firing" }, { state: "pending" }],
				},
			}),
		});
		const res2 = await quiesceCheck1.run();
		assert.equal(res2.status, "warn");
		assert.equal(
			res2.detail,
			"1 firing / 1 pending — run `pnpm forge quiesce <use-case>` before arm",
		);

		// Configured useCase hint
		const checks2 = defineChecks({
			prometheusUrl: "http://localhost:9090",
			useCase: "mycase",
		});
		const quiesceCheck2 = checks2.find(
			(c) => c.id === "observability-quiescence",
		);
		const res3 = await quiesceCheck2.run();
		assert.equal(res3.status, "warn");
		assert.equal(
			res3.detail,
			"1 firing / 1 pending — run `pnpm forge quiesce mycase` before arm",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ambient-furniture check reports enabled status, rules, and commits using git repo and descriptor", async () => {
	const tmpDir = join(tmpdir(), `doctor-ambient-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	try {
		execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "TestAuthor"], {
			cwd: tmpDir,
			stdio: "ignore",
		});
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: tmpDir,
			stdio: "ignore",
		});
		writeFileSync(join(tmpDir, "dummy.txt"), "hello");
		execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "ignore" });
		execFileSync("git", ["commit", "-m", "initial commit"], {
			cwd: tmpDir,
			stdio: "ignore",
		});

		const rulesFile = join(tmpDir, "ambient-rules.yml");
		writeFileSync(rulesFile, "groups: []");

		const configAbsent = {
			substratePath: tmpDir,
			ambientRulesPath: join(tmpDir, "nonexistent.yml"),
			ambientAlertName: "TestAlert",
			ambientAlertService: "test-service",
			ambientCommitAuthor: "TestAuthor",
			ambientCommitSubject: "test: ambient commit",
		};
		const checkAbsent = defineChecks(configAbsent).find(
			(c) => c.id === "ambient-furniture",
		);
		const resAbsent = await checkAbsent.run();
		assert.equal(resAbsent.status, "pass");
		assert.match(resAbsent.detail, /Ambient furniture status: ENABLED/);
		assert.match(resAbsent.detail, /Ambient alert rule: ABSENT/);
		assert.match(resAbsent.detail, /Recent deploy commit: ABSENT/);

		// Now add matching commit and test matching state
		writeFileSync(join(tmpDir, "dummy2.txt"), "world");
		execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "ignore" });
		execFileSync("git", ["commit", "-m", "test: ambient commit"], {
			cwd: tmpDir,
			stdio: "ignore",
		});

		const configPresent = {
			...configAbsent,
			ambientRulesPath: rulesFile,
		};
		const checkPresent = defineChecks(configPresent).find(
			(c) => c.id === "ambient-furniture",
		);
		const resPresent = await checkPresent.run();
		assert.equal(resPresent.status, "pass");
		assert.match(
			resPresent.detail,
			/Ambient alert rule: TestAlert \(service: test-service\)/,
		);
		assert.match(
			resPresent.detail,
			/Recent deploy commit: PRESENT \(TestAuthor: test: ambient commit\)/,
		);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("deployUpHint is defined for deploy plane checks", async () => {
	const checksDefault = defineChecks({
		deployServices: ["nonexistent-svc"],
		prometheusUrl: "http://localhost:9090",
	});
	const deployPlaneCheck = checksDefault.find((c) => c.id === "deploy-plane");
	const promCheck = checksDefault.find((c) => c.id === "alerting-prometheus");

	const res1 = await deployPlaneCheck.run();
	assert.equal(res1.status, "fail");
	assert.equal(res1.hint, "pnpm forge up <use-case>");

	const res2 = await promCheck.run();
	assert.equal(res2.status, "fail");
	assert.equal(res2.hint, "pnpm forge up <use-case>");

	const checksUseCase = defineChecks({
		deployServices: ["nonexistent-svc"],
		prometheusUrl: "http://localhost:9090",
		useCase: "booklogr",
	});
	const res3 = await checksUseCase.find((c) => c.id === "deploy-plane").run();
	assert.equal(res3.hint, "pnpm forge up booklogr");
});
