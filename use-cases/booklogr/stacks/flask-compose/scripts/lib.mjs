// Shared helpers for the booklogr flask-compose operational scripts.
// Zero dependencies (Node 18+ global fetch).

export const PROM = process.env.PROM_URL || "http://localhost:9090";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString();

// All currently-active alerts from Prometheus (not Alertmanager — Prometheus is
// the deterministic source of truth, with no group_wait latency).
export async function getAlerts(prom = PROM) {
	const res = await fetch(`${prom}/api/v1/alerts`);
	if (!res.ok) throw new Error(`prometheus /alerts ${res.status}`);
	const json = await res.json();
	return json?.data?.alerts ?? [];
}

export function firing(alerts, name) {
	return (
		alerts.find((a) => a.labels?.alertname === name && a.state === "firing") ||
		null
	);
}

export function firingNames(alerts) {
	return [
		...new Set(
			alerts
				.filter((a) => a.state === "firing")
				.map((a) => a.labels?.alertname),
		),
	];
}

export function pendingNames(alerts) {
	return [
		...new Set(
			alerts
				.filter((a) => a.state === "pending")
				.map((a) => a.labels?.alertname),
		),
	];
}

export async function getTargets(prom = PROM) {
	const res = await fetch(`${prom}/api/v1/targets`);
	if (!res.ok) throw new Error(`prometheus /targets ${res.status}`);
	const json = await res.json();
	return json?.data?.activeTargets ?? [];
}

export const BASELINE_EXPR =
	'sum(rate(flask_http_request_duration_seconds_count{job="booklogr-api"}[1m]))';

// Instant PromQL query -> first scalar value (number) or null.
export async function queryScalar(expr, prom = PROM) {
	const res = await fetch(
		`${prom}/api/v1/query?query=${encodeURIComponent(expr)}`,
	);
	if (!res.ok) return null;
	const json = await res.json();
	const r = json?.data?.result;
	if (!r || r.length === 0) return null;
	const v = Number(r[0]?.value?.[1]);
	return Number.isFinite(v) ? v : null;
}

// Service-wide p99 over a 30s window. Metric is prometheus-flask-exporter's
// default request-duration histogram; the `job` label is added by the
// Prometheus scrape config.
export const P99_EXPR =
	'histogram_quantile(0.99, sum by (le) (rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[30s])))';

export const PRIMARY_ALERT = "BooklogrApiLatencyP99High";

export function parseArgs() {
	return Object.fromEntries(
		process.argv.slice(2).map((a) => {
			const m = a.match(/^--([^=]+)(?:=(.*))?$/);
			return m ? [m[1], m[2] ?? "true"] : [a, "true"];
		}),
	);
}

export const DEPLOY_SERVICES = [
	"booklogr-db",
	"booklogr-api",
	"booklogr-web",
	"booklogr-prometheus",
	"booklogr-alertmanager",
	"booklogr-grafana",
	"booklogr-book-metadata",
];
