#!/usr/bin/env node
// confirm-quiesced gate (#74 / ADR-0010) for the booklogr stack.
//
// Polls Prometheus HTTP API until the observability plane is confirmed quiesced:
// 0 firing alerts, 0 pending alerts, all scrape targets healthy, and baseline
// metrics present (when require-baseline is set).
//
// Alerts labelled `role: ambient` are EXEMPT from the firing/pending assertion
// (#121) — they are deliberate furniture and are never quiet. They are still
// reported, so the exemption is visible rather than silent.
//
//   node scripts/confirm-quiesced.mjs [--deadline=120] [--interval=3] [--settle=3]
//                                     [--require-baseline=0|1] [--prom=URL]
//
// Every flag also has an env form, which is what the `arm` path uses since it
// does not forward flags: QUIESCE_DEADLINE_S, QUIESCE_POLL_INTERVAL_S,
// QUIESCE_SETTLE_CHECKS, QUIESCE_REQUIRE_BASELINE, QUIESCE_WARMUP_S, PROM_URL.
//
// Exit 0 = quiesced; exit 1 = timed out or container not running.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	BASELINE_EXPR,
	firingNames,
	getAlerts,
	getTargets,
	PROM,
	parseArgs,
	pendingNames,
	queryScalar,
	sleep,
} from "./lib.mjs";

// Alerts labelled `role: ambient` are deliberate background furniture (#121) and
// are never quiet by construction — EdgeClientRequestJitter reduces to
// `time() % 120 < 60`, so it is firing half of all wall-clock time regardless of
// what the stack is doing. Gating on them makes quiesce a race against a clock:
// the gate can only pass during the 60s down-phase and has to fit its whole
// settle streak inside it. Measured on the 2026-07-26/27 campaign, tightening a
// driver's gate to "every rule inactive" raised its failure rate from 33% to 57%
// for exactly this reason.
//
// Exempting by LABEL rather than by alert name is the point: a stack can add
// ambient furniture without every gate and every external driver having to learn
// a new hardcoded name. rules-lint enforces that the ambient service's rules
// carry this label, so the two cannot drift apart.
export const AMBIENT_ROLE = "ambient";

export function isAmbientAlert(alert) {
	return alert?.labels?.role === AMBIENT_ROLE;
}

export function parseRequireBaseline(val, fallback = 0) {
	if (val === undefined || val === null) return fallback;
	if (typeof val === "boolean") return val ? 1 : 0;
	const s = String(val).trim().toLowerCase();
	if (s === "true" || s === "1" || s === "") return 1;
	if (s === "false" || s === "0") return 0;
	const n = Number(s);
	return Number.isNaN(n) ? fallback : n ? 1 : 0;
}

export function classifyPoll({
	alerts = [],
	targets = [],
	baseline = null,
	requireBaseline = 0,
}) {
	// Ambient furniture is filtered out before the assertion, not after: it must
	// affect neither `clean` nor the reported firing/pending lists, or a timeout
	// diagnostic would name a rule the operator cannot do anything about.
	const gated = alerts.filter((a) => !isAmbientAlert(a));
	const ambient = [
		...new Set(
			alerts
				.filter((a) => isAmbientAlert(a) && a.state !== "inactive")
				.map((a) => a.labels?.alertname),
		),
	];
	const firing = firingNames(gated);
	const pending = pendingNames(gated);
	const targetsDown = targets
		.filter((t) => t.health !== "up")
		.map((t) => t.labels?.job ?? t.scrapeUrl);
	const baselinePresent = baseline != null && baseline > 0;
	const baselineOk = !requireBaseline || baselinePresent;
	const clean =
		firing.length === 0 &&
		pending.length === 0 &&
		targetsDown.length === 0 &&
		baselineOk;

	return {
		clean,
		firing,
		pending,
		targetsDown,
		baselinePresent,
		baselineOk,
		ambient,
	};
}

export async function runQuiesceLoop({
	fetchPoll,
	deadlineS = 120,
	intervalS = 3,
	settle = 3,
	requireBaseline = 0,
	nowFn = Date.now,
	sleepFn = sleep,
	logStderr = true,
	logStdout = true,
}) {
	const started = nowFn();
	const deadlineMs = started + deadlineS * 1000;
	let cleanStreak = 0;
	let lastFetchError = null;
	let lastRes = {
		clean: false,
		firing: [],
		pending: [],
		targetsDown: [],
		baselinePresent: false,
		baselineOk: !requireBaseline,
		ambient: [],
	};

	while (nowFn() < deadlineMs) {
		let pollData = null;
		try {
			pollData = await fetchPoll();
			lastFetchError = null;
		} catch (e) {
			lastFetchError = e.message;
			if (logStderr) {
				process.stderr.write(
					`[confirm-quiesced] prometheus not ready (${e.message}); retrying\n`,
				);
			}
			cleanStreak = 0;
			await sleepFn(intervalS * 1000);
			continue;
		}

		lastRes = classifyPoll({
			alerts: pollData.alerts,
			targets: pollData.targets,
			baseline: pollData.baseline,
			requireBaseline,
		});

		const elapsed = ((nowFn() - started) / 1000).toFixed(0);

		if (lastRes.clean) {
			cleanStreak++;
			if (cleanStreak >= settle) {
				if (logStderr) {
					process.stderr.write(
						`[confirm-quiesced] QUIESCED after ${elapsed}s (${settle} consecutive clean checks)` +
							`${lastRes.ambient?.length ? ` — ambient exempt: ${lastRes.ambient.join(",")}` : ""}\n`,
					);
				}
				const result = {
					ok: true,
					state: "quiesced",
					elapsed_seconds: Number(elapsed),
					settle_checks: settle,
				};
				if (logStdout) {
					console.log(JSON.stringify(result));
				}
				return result;
			}
			if (logStderr) {
				process.stderr.write(
					`[confirm-quiesced] not settled (streak ${cleanStreak}/${settle}): firing=[${lastRes.firing.join(",")}] pending=[${lastRes.pending.join(",")}] targets_down=[${lastRes.targetsDown.join(",")}] baseline=${lastRes.baselineOk ? "ok" : "missing"} ambient_exempt=[${(lastRes.ambient ?? []).join(",")}]\n`,
				);
			}
		} else {
			cleanStreak = 0;
			if (logStderr) {
				process.stderr.write(
					`[confirm-quiesced] not settled (streak 0/${settle}): firing=[${lastRes.firing.join(",")}] pending=[${lastRes.pending.join(",")}] targets_down=[${lastRes.targetsDown.join(",")}] baseline=${lastRes.baselineOk ? "ok" : "missing"} ambient_exempt=[${(lastRes.ambient ?? []).join(",")}]\n`,
				);
			}
		}

		await sleepFn(intervalS * 1000);
	}

	if (logStderr) {
		const errStr = lastFetchError
			? ` (prometheus_unreachable: true, fetch_error: ${lastFetchError})`
			: "";
		// Name the exempted ambient alerts in the timeout line. They did not cause
		// the timeout, but an operator reading this needs to know they were seen and
		// deliberately ignored — otherwise the next debugging session re-discovers
		// the metronome from scratch, which is what #121 was filed about.
		const ambientStr = lastRes.ambient?.length
			? ` (ambient, exempt: ${lastRes.ambient.join(",")})`
			: "";
		process.stderr.write(
			`[confirm-quiesced] QUIESCE_TIMEOUT after ${deadlineS}s — never settled${errStr}: firing=[${lastRes.firing.join(",")}] pending=[${lastRes.pending.join(",")}] targets_down=[${lastRes.targetsDown.join(",")}] baseline_present=${lastRes.baselinePresent}${ambientStr}\n`,
		);
	}
	const result = {
		ok: false,
		state: "quiesce_timeout",
		...(lastFetchError
			? { prometheus_unreachable: true, fetch_error: lastFetchError }
			: {}),
		unsettled: {
			firing: lastRes.firing,
			pending: lastRes.pending,
			targets_down: lastRes.targetsDown,
			baseline_present: lastRes.baselinePresent,
			ambient_exempt: lastRes.ambient ?? [],
		},
	};
	if (logStdout) {
		console.log(JSON.stringify(result));
	}
	return result;
}

export async function main() {
	const args = parseArgs();
	const deadlineS =
		Number(args.deadline ?? process.env.QUIESCE_DEADLINE_S) || 120;
	const intervalS =
		Number(args.interval ?? process.env.QUIESCE_POLL_INTERVAL_S) || 3;
	const settle = Number(args.settle ?? process.env.QUIESCE_SETTLE_CHECKS) || 3;
	const warmupS = Number(process.env.QUIESCE_WARMUP_S) || 0;
	const defaultRequireBaseline = warmupS > 0 ? 1 : 0;
	const rawReqBase =
		args["require-baseline"] ?? process.env.QUIESCE_REQUIRE_BASELINE;
	const requireBaseline = parseRequireBaseline(
		rawReqBase,
		defaultRequireBaseline,
	);
	const prom = args.prom || process.env.PROM_URL || PROM;

	const PROM_CONTAINER = args["prom-container"] || "booklogr-prometheus";
	try {
		const state = execFileSync(
			"docker",
			["inspect", "-f", "{{.State.Running}}", PROM_CONTAINER],
			{ encoding: "utf8", timeout: 5000 },
		).trim();
		if (state !== "true") {
			process.stderr.write(
				`[confirm-quiesced] FATAL: ${PROM_CONTAINER} container exists but is not running (state=${state})\n` +
					`               Did \`pnpm forge up booklogr\` succeed?\n`,
			);
			process.exit(1);
		}
	} catch (_e) {
		process.stderr.write(
			`[confirm-quiesced] FATAL: ${PROM_CONTAINER} container is not running — did \`pnpm forge up booklogr\` succeed?\n`,
		);
		process.exit(1);
	}

	const fetchPoll = async () => {
		const [alerts, targets, baseline] = await Promise.all([
			getAlerts(prom),
			getTargets(prom),
			queryScalar(BASELINE_EXPR, prom),
		]);
		return { alerts, targets, baseline };
	};

	const res = await runQuiesceLoop({
		fetchPoll,
		deadlineS,
		intervalS,
		settle,
		requireBaseline,
	});

	if (res.ok) {
		try {
			const runWs = path.resolve(
				path.dirname(fileURLToPath(import.meta.url)),
				"..",
				".run-workspace",
			);
			if (!fs.existsSync(runWs)) fs.mkdirSync(runWs, { recursive: true });
			fs.writeFileSync(
				path.join(runWs, "quiesced.json"),
				JSON.stringify(res, null, 2),
				"utf8",
			);
		} catch (_e) {
			// best effort
		}
	} else {
		process.exit(1);
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main().catch((err) => {
		process.stderr.write(`[confirm-quiesced] FATAL: ${err.message}\n`);
		process.exit(1);
	});
}
