import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRunnerStatus, UNUSED_EXIT_CODE } from "../confirm-runner.mjs";

const REAL_FORGE_PAYLOAD = {
	runners: [
		{
			id: 2,
			name: "actions-runner",
			status: "online",
			busy: false,
			disabled: false,
			labels: [{ id: 0, name: "ubuntu-latest", type: "custom" }],
		},
		{
			id: 1,
			name: "sreforge-local-runner",
			status: "offline",
			busy: false,
			disabled: false,
			labels: [{ id: 0, name: "ubuntu-latest", type: "custom" }],
		},
	],
	total_count: 2,
};

describe("confirm-runner gate classification tests (#106)", () => {
	it("1. Only an offline runner registered -> FAIL", () => {
		const offlinePayload = {
			runners: [
				{
					id: 1,
					name: "sreforge-local-runner",
					status: "offline",
					busy: false,
					disabled: false,
					labels: [{ id: 0, name: "ubuntu-latest", type: "custom" }],
				},
			],
			total_count: 1,
		};
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: offlinePayload,
			apiError: null,
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
		assert.equal(res.usedFallback, false);
	});

	it("2. A mix of online + offline (the real payload) -> PASS", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: REAL_FORGE_PAYLOAD,
			apiError: null,
		});
		assert.equal(res.ok, true);
		assert.equal(res.running, true);
		assert.equal(res.registered, true);
		assert.equal(res.reason, "ok");
		assert.equal(res.usedFallback, false);
		assert.equal(res.warning, null);
	});

	it("3. An online but disabled: true runner only -> FAIL", () => {
		const disabledPayload = {
			runners: [
				{
					id: 2,
					name: "actions-runner",
					status: "online",
					busy: false,
					disabled: true,
					labels: [],
				},
			],
			total_count: 1,
		};
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: disabledPayload,
			apiError: null,
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
	});

	it("4. Empty runners: [] / total_count: 0 -> FAIL", () => {
		const emptyPayload = { runners: [], total_count: 0 };
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: emptyPayload,
			apiError: null,
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
	});

	it("5. API error + log says registered -> PASS with non-authoritative warning", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: null,
			apiError: new Error("Network unreachable"),
			logText:
				"2026-07-26T19:00:00Z INFO Runner 'sreforge-runner' declare successfully",
		});
		assert.equal(res.ok, true);
		assert.equal(res.running, true);
		assert.equal(res.registered, true);
		assert.equal(res.reason, "ok");
		assert.equal(res.usedFallback, true);
		assert.match(res.warning, /non-authoritative/i);
	});

	it("6. API error + log says nothing -> FAIL", () => {
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: null,
			apiError: new Error("ECONNREFUSED"),
			logText:
				"Starting act_runner daemon...\nConnecting to http://sreforge-gitea:3000...",
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
		assert.equal(res.usedFallback, true);
	});

	it("7. API reachable and says no, while log says registered -> FAIL (API wins)", () => {
		const offlinePayload = {
			runners: [
				{
					id: 1,
					name: "sreforge-local-runner",
					status: "offline",
					disabled: false,
				},
			],
		};
		const res = classifyRunnerStatus({
			containerRunning: true,
			apiPayload: offlinePayload,
			apiError: null,
			logText: "Runner registered successfully",
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, true);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_registered");
		assert.equal(res.usedFallback, false);
	});

	it("8. Container not running -> FAIL regardless of everything else", () => {
		const res = classifyRunnerStatus({
			containerRunning: false,
			apiPayload: REAL_FORGE_PAYLOAD,
			apiError: null,
			logText: "Runner registered successfully",
		});
		assert.equal(res.ok, false);
		assert.equal(res.running, false);
		assert.equal(res.registered, false);
		assert.equal(res.reason, "runner_not_running");
	});

	it("9. Distinct exit code is 86", () => {
		assert.equal(UNUSED_EXIT_CODE, 86);
	});
});
