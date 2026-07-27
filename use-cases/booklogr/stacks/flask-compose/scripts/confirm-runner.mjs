#!/usr/bin/env node

// confirm-runner gate (#106) for the booklogr stack.
//
// Verifies that sreforge-runner container is BOTH running AND registered with
// Gitea before arming. Gitea REST API is the primary authority on registration
// (requiring at least one online, non-disabled runner). Container log matching
// is demoted to a fallback when the Gitea API is unreachable.
//
// Exit 0 = running and registered; exit 86 = not running or not registered.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNER_CONTAINER = "sreforge-runner";
export const RECOVERY_CMD =
	"docker compose -f infra/forge/forge.yml up -d --force-recreate act_runner";
export const UNUSED_EXIT_CODE = 86;

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadDotenv() {
	const envPath = resolve(HERE, "..", ".env");
	if (!existsSync(envPath)) return;
	for (const line of readFileSync(envPath, "utf8").split("\n")) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m || m[1] in process.env) continue;
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}

export function classifyRunnerStatus({
	containerRunning = false,
	apiPayload = null,
	apiError = null,
	logText = "",
}) {
	const running = Boolean(containerRunning);
	if (!running) {
		return {
			ok: false,
			running: false,
			registered: false,
			reason: "runner_not_running",
			usedFallback: false,
			warning: null,
		};
	}

	const runners = Array.isArray(apiPayload)
		? apiPayload
		: Array.isArray(apiPayload?.runners)
			? apiPayload.runners
			: null;

	const apiReachable = !apiError && runners !== null;

	if (apiReachable) {
		const registered = runners.some(
			(r) => r && r.status === "online" && r.disabled !== true,
		);
		return {
			ok: registered,
			running: true,
			registered,
			reason: registered ? "ok" : "runner_not_registered",
			usedFallback: false,
			warning: null,
		};
	}

	const logRegistered =
		/declare successfully/i.test(logText) ||
		/runner registered successfully/i.test(logText);

	return {
		ok: logRegistered,
		running: true,
		registered: logRegistered,
		reason: logRegistered ? "ok" : "runner_not_registered",
		usedFallback: true,
		warning: logRegistered
			? `WARNING: could not authoritatively confirm runner registration via the Gitea API (${apiError?.message || "no runner list returned"}). Falling back to the NON-AUTHORITATIVE container log, which cannot distinguish a stale registration from a live one.`
			: null,
	};
}

export async function fetchGiteaRunners({
	giteaUrl = process.env.GITEA_URL || "http://localhost:3000",
	adminUser = process.env.GITEA_ADMIN_USER,
	adminPassword = process.env.GITEA_ADMIN_PASSWORD,
	fetchFn = fetch,
} = {}) {
	// No credential defaults on purpose. A placeholder password would authenticate
	// as a 401, which is indistinguishable from "API down" and would silently drop
	// this gate back to the log-tail heuristic it exists to replace — reached by a
	// config mistake and reported as a network blip.
	if (!adminUser || !adminPassword) {
		return {
			payload: null,
			error: new Error(
				"GITEA_ADMIN_USER/GITEA_ADMIN_PASSWORD are not set — cannot authenticate to the Gitea admin API",
			),
		};
	}
	const baseUrl = giteaUrl.replace(/\/+$/, "");
	const endpoint = `${baseUrl}/api/v1/admin/actions/runners`;
	const credentials = Buffer.from(`${adminUser}:${adminPassword}`).toString(
		"base64",
	);

	try {
		const res = await fetchFn(endpoint, {
			method: "GET",
			headers: {
				Authorization: `Basic ${credentials}`,
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) {
			return {
				payload: null,
				error: new Error(`Gitea API returned HTTP ${res.status}`),
			};
		}

		const data = await res.json();
		return { payload: data, error: null };
	} catch (err) {
		return { payload: null, error: err };
	}
}

export async function checkRunner({
	container = RUNNER_CONTAINER,
	exec = execFileSync,
	fetchFn = fetch,
} = {}) {
	loadDotenv();

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

	let apiPayload = null;
	let apiError = null;

	if (containerRunning) {
		const fetchRes = await fetchGiteaRunners({ fetchFn });
		apiPayload = fetchRes.payload;
		apiError = fetchRes.error;
	}

	let logText = "";
	if (containerRunning && apiError) {
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

	return classifyRunnerStatus({
		containerRunning,
		apiPayload,
		apiError,
		logText,
	});
}

export async function main() {
	const res = await checkRunner();

	if (res.warning) {
		process.stderr.write(`[confirm-runner] ${res.warning}\n`);
	}

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
