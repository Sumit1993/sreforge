import { strict as assert } from "node:assert";
import { resolve } from "node:path";
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
