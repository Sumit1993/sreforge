import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function dockerInspect(
	container,
	format,
	{ timeoutMs = 5000, _exec = execFileSync } = {},
) {
	try {
		const args = format
			? ["inspect", "-f", format, container]
			: ["inspect", container];
		const out = _exec("docker", args, {
			encoding: "utf8",
			stdio: format ? ["ignore", "pipe", "ignore"] : "ignore",
			timeout: timeoutMs,
		});
		return format ? out.trim() : true;
	} catch {
		return format ? "" : false;
	}
}

export function isRunning(container, opts = {}) {
	return dockerInspect(container, "{{.State.Running}}", opts) === "true";
}

export function containerExists(container, opts = {}) {
	return dockerInspect(container, undefined, opts) === true;
}

export function getStartError(container, opts = {}) {
	return dockerInspect(container, "{{.State.Error}}", opts);
}

export function classifyHijack(resLocal, res127) {
	if (
		resLocal.status !== null &&
		res127.status !== null &&
		resLocal.status !== res127.status
	) {
		return "hijacked-proxy";
	}
	if (resLocal.status !== null && resLocal.status === res127.status) {
		const hasVersion = !!res127.json?.version;
		const isGiteaAuthError =
			(res127.status === 401 || res127.status === 403) &&
			((res127.json && res127.json.message !== undefined) ||
				res127.headers?.["set-cookie"]?.includes("i_like_gitea"));
		if (hasVersion || isGiteaAuthError) {
			return "healthy";
		}
	}
	return "down";
}

export function classifyRunnerError(stderrText) {
	if (
		/OCI runtime create failed.*docker-mounts.*not a directory/.test(stderrText)
	) {
		return "stale-shim";
	}
	return "other";
}

export function classifyWincred(stderrText) {
	if (/docker-credential-wincred\.exe.*exec format error/.test(stderrText)) {
		return "interop-broken";
	}
	return "other";
}

export function diffEnvKeys(exampleText, envText) {
	const getKeys = (txt) =>
		txt
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"))
			.map((l) => l.split("=")[0].trim());

	const exKeys = getKeys(exampleText);
	const envKeys = new Set(getKeys(envText));

	const missing = exKeys.filter((k) => !envKeys.has(k));
	return missing;
}

export function summarize(results) {
	const lines = [];
	let exitCode = 0;
	for (const r of results) {
		lines.push(`${r.status.toUpperCase()} ${r.plane}/${r.id} — ${r.detail}`);
		if (r.hint) {
			lines.push(`  hint: ${r.hint}`);
		}
		if (r.status === "fail") exitCode = 1;
	}
	return { lines, exitCode };
}

export async function runAllChecks(checks) {
	const results = [];
	for (const check of checks) {
		let timer;
		try {
			const result = await Promise.race([
				check.run(),
				new Promise((_, reject) => {
					timer = setTimeout(() => reject(new Error("check timed out")), 5000);
				}),
			]);
			results.push({ id: check.id, plane: check.plane, ...result });
		} catch (e) {
			results.push({
				id: check.id,
				plane: check.plane,
				status: "fail",
				detail: e.message,
			});
		} finally {
			clearTimeout(timer);
		}
	}
	return results;
}

export function resolveRepoRoot(usecasePath) {
	return resolve(usecasePath, "../..");
}

export function defineChecks(config) {
	const {
		giteaLocalhostUrl,
		gitea127Url,
		giteaAdminUser,
		giteaAdminPass,
		giteaMaintUser,
		giteaMaintPass,
		giteaOwner,
		giteaRepo,
		runnerContainer,
		giteaContainer,
		envPath,
		exampleEnvPath,
		substratePath,
		coreNodeModulesPath,
		coreDistPath,
		rootNodeModulesPath,
		deployServices,
		prometheusUrl,
		alertmanagerUrl,
		useCase,
		quiesceHint: customQuiesceHint,
	} = config;

	const quiesceHint =
		customQuiesceHint ??
		(useCase
			? `pnpm forge quiesce ${useCase}`
			: "pnpm forge quiesce <use-case>");

	const safeFetch = async (url, options = {}) => {
		try {
			const res = await fetch(url, options);
			const headers = {};
			res.headers.forEach((v, k) => {
				headers[k] = v;
			});
			return {
				status: res.status,
				ok: res.ok,
				json: await res.json().catch(() => ({})),
				headers,
			};
		} catch {
			return { status: null, ok: false, json: {}, headers: {} };
		}
	};

	let hijackDetected = false;

	return [
		{
			id: "wsl-interop",
			plane: "host",
			run: async () => {
				try {
					execFileSync("docker", ["info"], {
						stdio: "pipe",
						encoding: "utf8",
						timeout: 5000,
					});
					return { status: "pass", detail: "docker responsive" };
				} catch (err) {
					const stderr = err.stderr || err.message || "";
					const classification = classifyWincred(stderr);
					if (classification === "interop-broken") {
						return {
							status: "fail",
							detail: "wincred interop broken",
							hint: "shim a Linux docker-credential-wincred.exe returning credentials not found in native keychain exit 1, or re-register binfmt / wsl.exe --shutdown",
						};
					}
					return {
						status: "fail",
						detail: "docker unresponsive or error",
						hint: stderr.split("\n")[0],
					};
				}
			},
		},
		{
			id: "bootstrap-env",
			plane: "host",
			run: async () => {
				let exText;
				try {
					exText = readFileSync(exampleEnvPath, "utf8");
				} catch (_e) {
					return {
						status: "fail",
						detail: `.env.example missing or unreadable at ${exampleEnvPath}`,
						hint: "create a .env.example file with expected variables to check against",
					};
				}
				if (!existsSync(envPath)) {
					const missing = diffEnvKeys(exText, "");
					return {
						status: "fail",
						detail: `.env missing, requires keys: ${missing.join(", ")}`,
						hint: "cp from sibling checkout (both are gitignored — verified) as the DEFAULT, or cp .env.example .env and fill it",
					};
				}
				const envText = readFileSync(envPath, "utf8");
				const missing = diffEnvKeys(exText, envText);
				if (missing.length > 0)
					return {
						status: "fail",
						detail: `.env missing keys: ${missing.join(", ")}`,
						hint: "update .env with missing keys",
					};
				return { status: "pass", detail: ".env ok" };
			},
		},
		{
			id: "bootstrap-substrate",
			plane: "host",
			run: async () => {
				if (!existsSync(substratePath))
					return {
						status: "fail",
						detail: "substrate missing",
						hint: 'cp -r FROM sibling checkout ("both are gitignored — verified") as the DEFAULT; scripts/import-substrate.sh as last resort (warning: re-import mutates shared Gitea state)',
					};
				return { status: "pass", detail: "substrate ok" };
			},
		},
		{
			id: "bootstrap-core",
			plane: "host",
			run: async () => {
				if (!existsSync(coreNodeModulesPath) || !existsSync(coreDistPath))
					return {
						status: "fail",
						detail: "core unbuilt",
						hint: "pnpm --dir core install (note root install silently skips it)",
					};
				return { status: "pass", detail: "core built" };
			},
		},
		{
			id: "bootstrap-root",
			plane: "host",
			run: async () => {
				if (!existsSync(rootNodeModulesPath))
					return {
						status: "fail",
						detail: "root unbuilt",
						hint: "pnpm install",
					};
				return { status: "pass", detail: "root dependencies ok" };
			},
		},
		{
			id: "port-hijack",
			plane: "forge",
			run: async () => {
				const [resLocal, res127] = await Promise.all([
					safeFetch(`${giteaLocalhostUrl}/api/v1/version`),
					safeFetch(`${gitea127Url}/api/v1/version`),
				]);
				const cls = classifyHijack(resLocal, res127);
				if (cls === "hijacked-proxy") {
					hijackDetected = true;
					return {
						status: "fail",
						detail: `port 3000 hijacked (localhost:${resLocal.status} vs 127:${res127.status})`,
						hint: 'VS Code PORTS → stop forwarding / kill extension host via `ss -ltnp | grep :3000`; add `remote.portsAttributes {"3000":{"onAutoForward":"ignore"}}`; then RESTART gitea — it only binds at container start',
					};
				}
				if (cls === "healthy")
					return { status: "pass", detail: "gitea port bound correctly" };
				return {
					status: "fail",
					detail: "gitea unreachable",
					hint: "pnpm forge forge-up",
				};
			},
		},
		{
			id: "stale-runner-shim",
			plane: "forge",
			run: async () => {
				try {
					const running = execFileSync(
						"docker",
						["inspect", "-f", "{{.State.Running}}", runnerContainer],
						{ encoding: "utf8", stdio: "pipe", timeout: 5000 },
					).trim();
					if (running === "true")
						return { status: "pass", detail: "runner running" };
					const err = execFileSync(
						"docker",
						["inspect", "-f", "{{.State.Error}}", runnerContainer],
						{ encoding: "utf8", stdio: "pipe", timeout: 5000 },
					).trim();
					const cls = classifyRunnerError(err);
					if (cls === "stale-shim")
						return {
							status: "fail",
							detail: "stale runner shim mount detected",
							hint: "pnpm forge forge-up",
						};
					return {
						status: "fail",
						detail: "runner not running",
						hint: "pnpm forge forge-up",
					};
				} catch {
					return {
						status: "fail",
						detail: "runner container missing",
						hint: "pnpm forge forge-up",
					};
				}
			},
		},
		{
			id: "cred-drift",
			plane: "forge",
			run: async () => {
				const adminRes = await safeFetch(`${gitea127Url}/api/v1/version`, {
					headers: {
						Authorization:
							"Basic " +
							Buffer.from(`${giteaAdminUser}:${giteaAdminPass}`).toString(
								"base64",
							),
					},
				});
				const maintRes = await safeFetch(`${gitea127Url}/api/v1/user`, {
					headers: {
						Authorization:
							"Basic " +
							Buffer.from(`${giteaMaintUser}:${giteaMaintPass}`).toString(
								"base64",
							),
					},
				});
				const failedUsers = [];
				if (adminRes.status !== 200) failedUsers.push(giteaAdminUser);
				if (maintRes.status !== 200) failedUsers.push(giteaMaintUser);

				if (failedUsers.length > 0) {
					if (hijackDetected) {
						return {
							status: "warn",
							detail: "credentials fail, but unreliable while port is hijacked",
						};
					}
					const hints = failedUsers.map(
						(u) =>
							`docker exec -u git ${giteaContainer} gitea admin user change-password --username ${u} --password <pass> --must-change-password=false`,
					);
					return {
						status: "fail",
						detail: `credentials invalid for ${failedUsers.join(", ")}`,
						hint: `${hints.join(" ; ")} then task setup to re-mint the run-ops token`,
					};
				}
				return { status: "pass", detail: "credentials valid" };
			},
		},
		{
			id: "repo-exists",
			plane: "forge",
			run: async () => {
				const res = await safeFetch(
					`${gitea127Url}/api/v1/repos/${giteaOwner}/${giteaRepo}`,
					{
						headers: {
							Authorization:
								"Basic " +
								Buffer.from(`${giteaAdminUser}:${giteaAdminPass}`).toString(
									"base64",
								),
						},
					},
				);
				if (res.status === 200)
					return { status: "pass", detail: "repo exists" };
				return {
					status: "fail",
					detail: `repo missing or inaccessible (status ${res.status})`,
					hint: "task setup",
				};
			},
		},
		{
			id: "deploy-plane",
			plane: "deploy",
			run: async () => {
				let count = 0;
				const details = [];
				for (const svc of deployServices) {
					try {
						const out = execFileSync(
							"docker",
							[
								"inspect",
								"-f",
								"{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
								svc,
							],
							{ encoding: "utf8", stdio: "pipe", timeout: 5000 },
						).trim();
						if (out.includes("running") && !out.includes("unhealthy")) {
							count++;
						} else {
							details.push(`${svc}: ${out}`);
						}
					} catch {
						details.push(`${svc}: missing`);
					}
				}
				if (count === deployServices.length)
					return {
						status: "pass",
						detail: `${count}/${deployServices.length} healthy`,
					};
				return {
					status: "fail",
					detail: `${count}/${deployServices.length} healthy (${details.join(", ")})`,
					hint: deployUpHint,
				};
			},
		},
		{
			id: "alerting-prometheus",
			plane: "deploy",
			run: async () => {
				const res = await safeFetch(`${prometheusUrl}/api/v1/alerts`);
				if (res.status === 200 && res.json?.status === "success")
					return { status: "pass", detail: "prometheus ok" };
				return {
					status: "fail",
					detail: "prometheus unreachable or invalid response",
					hint: deployUpHint,
				};
			},
		},
		{
			id: "alerting-alertmanager",
			plane: "deploy",
			run: async () => {
				const res = await safeFetch(`${alertmanagerUrl}/api/v1/status`);
				if (res.status === 200 || res.status === 404)
					return { status: "pass", detail: "alertmanager reachable" };
				return {
					status: "warn",
					detail: "alertmanager down (status quo routes to null receiver)",
				};
			},
		},
		{
			id: "observability-quiescence",
			plane: "deploy",
			run: async () => {
				const res = await safeFetch(`${prometheusUrl}/api/v1/alerts`);
				if (res.status !== 200 || res.json?.status !== "success") {
					return {
						status: "warn",
						detail: "prometheus unreachable (cannot query quiescence)",
					};
				}
				const alerts = res.json?.data?.alerts;
				if (!Array.isArray(alerts)) {
					return {
						status: "warn",
						detail: "prometheus returned malformed alerts payload",
					};
				}
				const firing = alerts.filter(
					(a) => a && typeof a === "object" && a.state === "firing",
				).length;
				const pending = alerts.filter(
					(a) => a && typeof a === "object" && a.state === "pending",
				).length;
				if (firing === 0 && pending === 0) {
					return { status: "pass", detail: "0 firing / 0 pending" };
				}
				return {
					status: "warn",
					detail: `${firing} firing / ${pending} pending — run \`${quiesceHint}\` before arm`,
				};
			},
		},
		{
			id: "ambient-furniture",
			plane: "deploy",
			run: async () => {
				const enabled = process.env.AMBIENT_FURNITURE !== "0";
				const rulesFile = config.ambientRulesPath || null;
				const rulesPresent = rulesFile ? existsSync(rulesFile) : false;
				let commitPresent = false;
				const substratePath = config.substratePath || null;
				const author = config.ambientCommitAuthor;
				const subject = config.ambientCommitSubject;
				const expectedPattern =
					author && subject ? `${author}: ${subject}` : null;
				if (substratePath && expectedPattern) {
					try {
						const gitLog = execFileSync(
							"git",
							["-C", substratePath, "log", "-n", "5", "--format=%an: %s"],
							{
								encoding: "utf8",
								stdio: ["ignore", "pipe", "ignore"],
								timeout: 5000,
							},
						);
						if (gitLog.includes(expectedPattern)) {
							commitPresent = true;
						}
					} catch {}
				}

				const statusStr = enabled
					? "ENABLED (AMBIENT_FURNITURE=1)"
					: "DISABLED (AMBIENT_FURNITURE=0)";
				const alertName = config.ambientAlertName || "ambient-alert";
				const alertService = config.ambientAlertService || "ambient-service";
				const ruleStr = rulesPresent
					? `${alertName} (service: ${alertService})`
					: "ABSENT";
				const commitStr = commitPresent && expectedPattern
					? `PRESENT (${expectedPattern})`
					: "ABSENT";

				return {
					status: "pass",
					detail: `Ambient furniture status: ${statusStr} | Ambient alert rule: ${ruleStr} | Recent deploy commit: ${commitStr}`,
				};
			},
		},
	];
}
