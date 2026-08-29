#!/usr/bin/env node
// =============================================================================
// lint.mjs — issue #76: verify all Prometheus alert rules carry a `service` label.
//
// Rationale: `no_new_alerts` in the compound oracle is scoped by the alert's `service`
// label (PR #71). An alert rule missing a `service` label silently escapes
// regression counting (fail-open). This offline lint asserts every rule in
// `observability/rules/*.yml` AND `furniture/*.yml` carries a nested `service`
// label, plus two ambient invariants (#121) — see AMBIENT_SERVICE below.
//
// Usage:
//   node tools/rules-lint/lint.mjs [<file|glob> ...]
// Exit 0 = all valid; 1 = missing label(s); 2 = usage/parse error.
// =============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// One definition, used by BOTH ambient invariants below. They are a matched pair —
// the forward check ("ambient rules carry role: ambient") and the reverse check
// ("non-ambient rules don't claim it") must agree on which service is ambient. Two
// independent literals meant renaming the ambient service silently disabled the
// forward check while making the reverse check start rejecting legitimate new
// furniture, which pressures an author into dropping the label the gate needs.
export const AMBIENT_SERVICE = "edge-client";

// Both the SERVED rules dir and the FURNITURE dir. arm-regress.sh installs
// furniture/ambient-rules.yml over observability/rules/ambient-rules.yml on every
// arm, so linting only the served copy checks a file that any arm overwrites — a
// label required by the quiesce gate (#121) would survive exactly one run. The
// authoritative source has to be in scope or the guard is theatre.
export const DEFAULT_TARGETS = [
	"use-cases/booklogr/stacks/flask-compose/observability/rules/*.yml",
	"use-cases/booklogr/stacks/flask-compose/furniture/*.yml",
];

function isValidServiceValue(rawVal) {
	if (!rawVal) return false;
	let val = rawVal.trim();
	if (
		(val.startsWith('"') && val.endsWith('"')) ||
		(val.startsWith("'") && val.endsWith("'"))
	) {
		val = val.slice(1, -1).trim();
	}
	if (!val || val === "~" || val.toLowerCase() === "null") return false;
	return true;
}

function globToRegExp(pattern) {
	const escaped = pattern.replace(/[.+^${}()|\\[\]]/g, "\\$&");
	const regexStr = `^${escaped.replace(/\*/g, "[^/]*").replace(/\?/g, ".")}$`;
	return new RegExp(regexStr);
}

/**
 * Lint YAML content string for Prometheus alert rules missing a `service` label.
 * @param {string} content - YAML content
 * @param {string} file - Filename/path (for error reporting)
 * @param {{totalAlerts?: number}} [stats] - Optional object to collect statistics
 * @returns {Array<{file: string, line: number, alert: string}>} List of failures
 */
export function lintContent(content, file = "", stats = null) {
	const lines = content.split(/\r?\n/);
	const failures = [];
	let currentAlert = null;

	function finalizeCurrent() {
		if (!currentAlert) return;
		if (!currentAlert.hasService) {
			failures.push({
				file: currentAlert.file,
				line: currentAlert.line,
				alert: currentAlert.alert,
			});
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		// Ignore full-line comments and empty lines
		if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
			continue;
		}

		// New group starts
		if (/^\s*-\s*name:/.test(line)) {
			finalizeCurrent();
			currentAlert = null;
			continue;
		}

		// New alert starts
		const alertMatch = line.match(/^(\s*)-\s*alert:\s*(\S.*?)\s*$/);
		if (alertMatch) {
			finalizeCurrent();
			if (stats) {
				stats.totalAlerts = (stats.totalAlerts || 0) + 1;
			}
			let alertName = alertMatch[2].trim();
			if (
				(alertName.startsWith('"') && alertName.endsWith('"')) ||
				(alertName.startsWith("'") && alertName.endsWith("'"))
			) {
				alertName = alertName.slice(1, -1);
			}
			const indent = alertMatch[1].length;
			currentAlert = {
				file,
				line: lineNum,
				alert: alertName,
				indent,
				hasService: false,
				inLabels: false,
				labelsIndent: null,
			};
			continue;
		}

		// Within alert block
		if (currentAlert) {
			const lineIndentMatch = line.match(/^(\s*)/);
			const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

			if (lineIndent <= currentAlert.indent) {
				finalizeCurrent();
				currentAlert = null;
				continue;
			}

			const lineWithoutComment = line.replace(/#.*$/, "").trimEnd();

			if (currentAlert.inLabels) {
				if (lineIndent <= currentAlert.labelsIndent) {
					currentAlert.inLabels = false;
				} else {
					const serviceMatch = lineWithoutComment.match(/^\s*service:\s*(.*)$/);
					if (serviceMatch && isValidServiceValue(serviceMatch[1])) {
						currentAlert.hasService = true;
					}
				}
			}

			if (!currentAlert.inLabels) {
				if (/^\s*labels:\s*$/.test(lineWithoutComment)) {
					currentAlert.inLabels = true;
					currentAlert.labelsIndent = lineIndent;
				}
			}
		}
	}

	finalizeCurrent();
	return failures;
}

/**
 * Lint a single file.
 * @param {string} filePath
 * @param {{totalAlerts?: number}} [stats]
 * @returns {Array<{file: string, line: number, alert: string}>}
 */
export function lintFile(filePath, stats = null) {
	const content = readFileSync(filePath, "utf8");
	return lintContent(content, filePath, stats);
}

/**
 * Lint multiple files.
 * @param {string[]} filePaths
 * @param {{totalAlerts?: number}} [stats]
 * @returns {Array<{file: string, line: number, alert: string}>}
 */
export function lintRules(filePaths, stats = null) {
	const failures = [];
	for (const f of filePaths) {
		failures.push(...lintFile(f, stats));
	}
	return failures;
}

/**
 * Expand CLI arguments/globs to concrete file paths.
 * Node 20 safe (does not use fs.globSync).
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function resolveTargets(patterns) {
	const files = [];
	for (const pattern of patterns) {
		if (existsSync(pattern)) {
			const stat = statSync(pattern);
			if (stat.isFile()) {
				files.push(pattern);
			} else if (stat.isDirectory()) {
				const entries = readdirSync(pattern, { withFileTypes: true });
				for (const entry of entries) {
					if (
						entry.isFile() &&
						(entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
					) {
						files.push(join(pattern, entry.name));
					}
				}
			}
		} else {
			// Simple glob expansion: e.g. path/to/rules/*.yml
			const wildcardIndex = pattern.search(/[*?[]/);
			if (wildcardIndex !== -1) {
				const lastSlash = pattern.lastIndexOf("/");
				const dir = lastSlash !== -1 ? pattern.slice(0, lastSlash) : ".";
				const filenamePattern =
					lastSlash !== -1 ? pattern.slice(lastSlash + 1) : pattern;
				if (existsSync(dir)) {
					const regex = globToRegExp(filenamePattern);
					const entries = readdirSync(dir, { withFileTypes: true });
					for (const entry of entries) {
						if (entry.isFile() && regex.test(entry.name)) {
							files.push(join(dir, entry.name));
						}
					}
				}
			}
		}
	}
	// Unique and sorted
	return Array.from(new Set(files)).sort();
}

/**
 * Check that the ambient service is unscoped (not in verify.services) in all scenario manifests.
 * @param {string} scenariosDir
 * @param {string} ambientService
 * @returns {{count: number, errors: string[]}}
 */
export function checkUnscopedAmbientService(
	scenariosDir = "use-cases/booklogr/scenarios",
	ambientService = AMBIENT_SERVICE,
) {
	const resolvedDir = resolve(REPO_ROOT, scenariosDir);
	const errors = [];
	if (!existsSync(resolvedDir)) return { count: 0, errors };

	const entries = readdirSync(resolvedDir, { withFileTypes: true });
	let count = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const manifestPath = join(resolvedDir, entry.name, "scenario.toml");
		if (!existsSync(manifestPath)) continue;
		count++;
		const content = readFileSync(manifestPath, "utf8");
		// NOTE: deliberately no `m` flag, and the section header is consumed by
		// `[^\n]*\n` rather than `\s*`. With `/m`, `$` matches at every line end and
		// the lazy capture terminated after the FIRST key line of the block — so this
		// invariant silently inspected only `oracle = "..."` and passed everything
		// else, including a scenario that really did declare the ambient service. It
		// printed "Invariant passed" while checking nothing. Same trap, same fix, and
		// now the same regex as confirm-quiesced.mjs and tools/headroom/campaign.mjs.
		const verifyMatch = content.match(
			/(?:^|\n)\[verify\][^\n]*\n([\s\S]*?)(?=\n\[|$)/,
		);
		if (verifyMatch) {
			const verifyContent = verifyMatch[1];
			const servicesMatch = verifyContent.match(/services\s*=\s*\[(.*?)\]/s);
			if (servicesMatch) {
				const servicesStr = servicesMatch[1];
				if (
					servicesStr.includes(`"${ambientService}"`) ||
					servicesStr.includes(`'${ambientService}'`)
				) {
					errors.push(
						`Scenario '${entry.name}' includes ambient service '${ambientService}' in verify.services`,
					);
				}
			}
		}
	}
	return { count, errors };
}

/**
 * Extract the `service` and `role` label values for every alert rule in a rules file.
 * Same line-oriented, labels-block-scoped parse as lintContent — no YAML dependency.
 * @param {string} content - YAML content
 * @param {string} file - Filename/path (for error reporting)
 * @returns {Array<{alert: string, line: number, service: string|null, role: string|null}>}
 */
export function extractAlertLabels(content, file = "") {
	const lines = content.split(/\r?\n/);
	const out = [];
	let cur = null;

	const finalize = () => {
		if (cur) out.push(cur);
		cur = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

		if (/^\s*-\s*name:/.test(line)) {
			finalize();
			continue;
		}

		const alertMatch = line.match(/^(\s*)-\s*alert:\s*(\S.*?)\s*$/);
		if (alertMatch) {
			finalize();
			let name = alertMatch[2].trim();
			if (
				(name.startsWith('"') && name.endsWith('"')) ||
				(name.startsWith("'") && name.endsWith("'"))
			) {
				name = name.slice(1, -1);
			}
			cur = {
				file,
				alert: name,
				line: i + 1,
				service: null,
				role: null,
				indent: alertMatch[1].length,
				inLabels: false,
				labelsIndent: null,
			};
			continue;
		}

		if (!cur) continue;

		const lineIndent = (line.match(/^(\s*)/) || ["", ""])[1].length;
		if (lineIndent <= cur.indent) {
			finalize();
			continue;
		}

		const bare = line.replace(/#.*$/, "").trimEnd();

		if (cur.inLabels) {
			if (lineIndent <= cur.labelsIndent) {
				cur.inLabels = false;
			} else {
				const svc = bare.match(/^\s*service:\s*(.*)$/);
				if (svc && isValidServiceValue(svc[1])) {
					cur.service = svc[1].trim().replace(/^["']|["']$/g, "");
				}
				const role = bare.match(/^\s*role:\s*(.*)$/);
				if (role?.[1]?.trim()) {
					cur.role = role[1].trim().replace(/^["']|["']$/g, "");
				}
			}
		}

		if (!cur.inLabels && /^\s*labels:\s*$/.test(bare)) {
			cur.inLabels = true;
			cur.labelsIndent = lineIndent;
		}
	}

	finalize();
	return out.map(({ alert, line, service, role }) => ({
		file,
		alert,
		line,
		service,
		role,
	}));
}

/**
 * Check that `role: ambient` and the ambient service agree with each other (#121).
 *
 * `confirm-quiesced` exempts alerts labelled `role: ambient` from its firing/pending
 * assertion. That exemption is only safe if the label means exactly one thing, so this
 * enforces the equivalence in BOTH directions:
 *
 *   - a rule on the ambient service MUST carry `role: ambient` — otherwise new ambient
 *     furniture silently re-acquires the power to deadlock the quiesce gate, which is
 *     the #121 regression;
 *   - a rule NOT on the ambient service must NOT carry `role: ambient` — otherwise a
 *     real scenario signal can quietly opt itself out of the gate, which would let a
 *     run arm on a genuinely dirty plane.
 *
 * @param {string[]} filePaths
 * @param {string} ambientService
 * @returns {{count: number, errors: string[]}}
 */
export function checkAmbientRoleConsistency(
	filePaths = [],
	ambientService = AMBIENT_SERVICE,
) {
	const errors = [];
	let count = 0;

	for (const filePath of filePaths) {
		if (!existsSync(filePath)) continue;
		const rel = relative(REPO_ROOT, filePath) || filePath;
		for (const a of extractAlertLabels(readFileSync(filePath, "utf8"), rel)) {
			const isAmbientService = a.service === ambientService;
			const claimsAmbientRole = a.role === "ambient";
			if (isAmbientService) count++;

			if (isAmbientService && !claimsAmbientRole) {
				errors.push(
					`${rel}:${a.line} alert "${a.alert}" is on the ambient service '${ambientService}' but has no \`role: ambient\` label — confirm-quiesced would gate on it (#121)`,
				);
			}
			if (!isAmbientService && claimsAmbientRole) {
				errors.push(
					`${rel}:${a.line} alert "${a.alert}" claims \`role: ambient\` but its service is '${a.service ?? "(none)"}', not '${ambientService}' — a scenario signal must not exempt itself from the quiesce gate (#121)`,
				);
			}
		}
	}

	return { count, errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
	let rawArgs = process.argv.slice(2);
	if (rawArgs.length === 0) {
		rawArgs = [...DEFAULT_TARGETS];
	}

	let filePaths;
	try {
		filePaths = resolveTargets(rawArgs);
	} catch (_e) {
		console.error("usage: rules-lint.mjs <rules-glob-or-file> [...]");
		process.exit(2);
	}

	if (filePaths.length === 0) {
		console.error("usage: rules-lint.mjs <rules-glob-or-file> [...]");
		process.exit(2);
	}

	const stats = { totalAlerts: 0 };
	let failures;
	try {
		failures = lintRules(filePaths, stats);
	} catch (_e) {
		console.error("usage: rules-lint.mjs <rules-glob-or-file> [...]");
		process.exit(2);
	}

	const totalAlerts = stats.totalAlerts;
	const totalFiles = filePaths.length;

	const scenarioCheck = checkUnscopedAmbientService();
	if (scenarioCheck.count > 0) {
		console.log(
			`[rules-lint] Checked ${scenarioCheck.count} scenario manifests.`,
		);
		if (scenarioCheck.errors.length > 0) {
			for (const err of scenarioCheck.errors) {
				console.error(`[rules-lint] FAIL: ${err}`);
			}
			process.exit(1);
		} else {
			console.log(
				`[rules-lint] Invariant passed: ambient service '${AMBIENT_SERVICE}' is unscoped in all scenario verification targets.`,
			);
		}
	}

	const roleCheck = checkAmbientRoleConsistency(filePaths);
	if (roleCheck.errors.length > 0) {
		for (const err of roleCheck.errors) {
			console.error(`[rules-lint] FAIL: ${err}`);
		}
		process.exit(1);
	}
	console.log(
		`[rules-lint] Invariant passed: ${roleCheck.count} ambient rule(s) carry \`role: ambient\`, and no non-ambient rule claims it.`,
	);

	if (failures.length > 0) {
		for (const f of failures) {
			console.error(
				`rules-lint: FAIL — ${f.file}:${f.line} alert "${f.alert}" has no service label`,
			);
		}
		console.error(
			`rules-lint: FAIL — ${failures.length} of ${totalAlerts} alert(s) missing a service label`,
		);
		process.exit(1);
	} else {
		console.log(
			`rules-lint: OK — ${totalAlerts} alert(s) across ${totalFiles} file(s), all carry a service label`,
		);
		console.log("[rules-lint] Found 0 errors.");
		process.exit(0);
	}
}
