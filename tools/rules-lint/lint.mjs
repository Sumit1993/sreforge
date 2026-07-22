#!/usr/bin/env node
// =============================================================================
// lint.mjs — issue #76: verify all Prometheus alert rules carry a `service` label.
//
// Rationale: `no_new_alerts` in the compound oracle is scoped by the alert's `service`
// label (PR #71). An alert rule missing a `service` label silently escapes
// regression counting (fail-open). This offline lint asserts every rule in
// `observability/rules/*.yml` carries a nested `service` label.
//
// Usage:
//   node tools/rules-lint/lint.mjs [<file|glob> ...]
// Exit 0 = all valid; 1 = missing label(s); 2 = usage/parse error.
// =============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const DEFAULT_TARGET =
	"use-cases/booklogr/stacks/flask-compose/observability/rules/*.yml";

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
	ambientService = "edge-client",
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
		const servicesMatch = content.match(/services\s*=\s*\[(.*?)\]/s);
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
	return { count, errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
	let rawArgs = process.argv.slice(2);
	if (rawArgs.length === 0) {
		rawArgs = [DEFAULT_TARGET];
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
				`[rules-lint] Invariant passed: ambient service 'edge-client' is unscoped in all scenario verification targets.`,
			);
		}
	}

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
