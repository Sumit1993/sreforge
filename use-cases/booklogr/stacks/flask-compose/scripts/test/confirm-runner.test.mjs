import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRunnerStatus, UNUSED_EXIT_CODE } from "../confirm-runner.mjs";

describe("confirm-runner gate classification tests", () => {
	it("1. container running and registered ('declare successfully') -> ok: true", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			logText:
				"2026-07-26T19:00:00Z INFO Runner 'sreforge-runner' declare successfully",
		});
		assert.equal(res.ok, true);
		assert.equal(res.running, true);
		assert.equal(res.registered, true);
		assert.equal(res.reason, "ok");
	});

	it("2. container running and registered ('Runner registered successfully') -> ok: true", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			logText: 'level=info msg="Runner registered successfully"',
		});
		assert.equal(res.ok, true);
		assert.equal(res.running, true);
		assert.equal(res.registered, true);
		assert.equal(res.reason, "ok");
	});

	it("3. container running but registration line missing -> ok: false, reason: runner_not_registered", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			logText:
				"Starting act_runner daemon...\nConnecting to http://sreforge-gitea:3000...",
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
	});

	it("4. container not running -> ok: false, reason: runner_not_running", () => {
		const res = classifyRunnerStatus({
			containerRunning: false,
			logText: "",
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, false);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_running");
	});

	it("5. distinct exit code is 86", () => {
		assert.equal(UNUSED_EXIT_CODE, 86);
	});
});
