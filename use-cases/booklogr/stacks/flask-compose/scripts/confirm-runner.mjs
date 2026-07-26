#!/usr/bin/env node

// confirm-runner gate (#106) for the booklogr stack.
//
// Verifies that sreforge-runner container is BOTH running AND registered with
// Gitea before arming. Registration is confirmed by checking for the runner's
// registration output line ("declare successfully" or "Runner registered successfully").
//
// Exit 0 = running and registered; exit 86 = not running or not registered.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNER_CONTAINER = "sreforge-runner";
export const RECOVERY_CMD =
	"docker compose -f infra/forge/forge.yml up -d --force-recreate act_runner";
export const UNUSED_EXIT_CODE = 86;

export function classifyRunnerStatus({
	containerRunning = false,
	logText = "",
}) {
	const running = Boolean(containerRunning);
	const registered =
		running &&
		(/declare successfully/i.test(logText) ||
			/runner registered successfully/i.test(logText));

	return {
		ok: running && registered,
		running,
		registered,
		reason: !running
			? "runner_not_running"
			: !registered
				? "runner_not_registered"
				: "ok",
	};
}

export function checkRunner({
	container = RUNNER_CONTAINER,
	exec = execFileSync,
} = {}) {
	let containerRunning = false;
	try {
		const out = exec(
			"docker",
			["inspect", "-f", "{{.State.Running}}", container],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			},
		).trim();
		containerRunning = out === "true";
	} catch {
		containerRunning = false;
	}

	let logText = "";
	if (containerRunning) {
		try {
			logText = exec("docker", ["logs", "--tail", "200", container], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			});
		} catch {
			logText = "";
		}
	}

	return classifyRunnerStatus({ containerRunning, logText });
}

export async function main() {
	const res = checkRunner();
	if (res.ok) {
		process.stderr.write(
			`[confirm-runner] ${RUNNER_CONTAINER} is running and registered with gitea\n`,
		);
		process.exit(0);
	}

	if (!res.running) {
		process.stderr.write(
			`[confirm-runner] FATAL: ${RUNNER_CONTAINER} container is not running (state=down)\n` +
				`               Recovery command: ${RECOVERY_CMD}\n`,
		);
	} else {
		process.stderr.write(
			`[confirm-runner] FATAL: ${RUNNER_CONTAINER} container is running but NOT registered with gitea\n` +
				`               Recovery command: ${RECOVERY_CMD}\n`,
		);
	}
	process.exit(UNUSED_EXIT_CODE);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main().catch((err) => {
		process.stderr.write(`[confirm-runner] FATAL: ${err.message}\n`);
		process.exit(UNUSED_EXIT_CODE);
	});
}
