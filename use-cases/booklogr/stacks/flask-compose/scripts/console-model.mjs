// =============================================================================
// console-model.mjs — shared data model for the OPERATOR CONSOLE (ADR-0018 §1).
//
// Pure gather (no rendering), reused by console.mjs (CLI) and console-serve.mjs
// (loopback web page): planes from `docker ps`, the incident from lib.mjs, and
// recent verdicts from the FileRunRecorder's records. REUSE, DON'T REBUILD —
// no observability is re-implemented; the real UIs are deep-linked (see LINKS).
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAlerts, firingNames, P99_EXPR, PRIMARY_ALERT, PROM, queryScalar } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK = dirname(HERE);
export const RUNS_DIR = resolve(STACK, "runs");

// Operator-facing host URLs (host-published ports; compose/docker-compose.yml +
// the forge). The human's links — distinct from the agent's in-network endpoints.
// Each lands where you'd actually work, not a service home page.
const GITEA_OWNER = process.env.GITEA_REPO_OWNER || "booklogr";
const GITEA_REPO = process.env.GITEA_REPO_NAME || "booklogr";
export const LINKS = {
  // The booklogr-api dashboard, last 6h, live-refreshing.
  Grafana: "http://localhost:3002/d/booklogr-api/booklogr-api?orgId=1&from=now-6h&to=now&timezone=browser&refresh=30s",
  // A p99 graph pre-loaded with the SLO expression (not the blank query page).
  Prometheus: `http://localhost:9090/graph?g0.expr=${encodeURIComponent(P99_EXPR)}&g0.tab=0&g0.range_input=1h`,
  // The active-alerts view.
  Alertmanager: "http://localhost:9093/#/alerts",
  // The repo's CI runs — where agent submissions get graded.
  "Gitea (forge)": `http://localhost:3000/${GITEA_OWNER}/${GITEA_REPO}/actions`,
  API: "http://localhost:5000/", // liveness + version
  web: "http://localhost:5150/", // the app UI
};

// Container groups → the plane each represents.
export const PLANES = {
  deploy: [
    "booklogr-api", "booklogr-web", "booklogr-db", "booklogr-prometheus",
    "booklogr-alertmanager", "booklogr-grafana", "booklogr-book-metadata",
  ],
  load: ["edge-client"],
  forge: ["sreforge-gitea"],
  "agent sandbox": ["agent-shell"],
  "mcp seam": ["booklogr-grafana-mcp"],
};

function runningContainers() {
  try {
    return new Set(
      execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
        .split("\n").map((s) => s.trim()).filter(Boolean),
    );
  } catch {
    return null; // docker unreachable
  }
}

function planeState(members, up) {
  const list = members.filter((m) => up.has(m));
  const n = list.length;
  const tag = n === 0 ? "down" : n === members.length ? "up" : "partial";
  return { tag, detail: n ? `${n}/${members.length}` : "", up: list };
}

function recentRuns(limit = 6) {
  if (!existsSync(RUNS_DIR)) return [];
  let dirs = [];
  try {
    dirs = readdirSync(RUNS_DIR).map((d) => join(RUNS_DIR, d)).filter((p) => {
      try { return statSync(p).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
  const rows = [];
  for (const d of dirs) {
    const rec = join(d, "record.json");
    if (!existsSync(rec)) continue;
    let r;
    try { r = JSON.parse(readFileSync(rec, "utf8")); } catch { continue; }
    let mtime = 0;
    try { mtime = statSync(rec).mtimeMs; } catch { /* ignore */ }
    rows.push({
      mtime,
      runId: r.runId || d.split("/").pop(),
      verdict: r.verdict ?? "?",
      score: typeof r.score === "number" ? r.score : r.score?.score, // score is the oracle obj
      scenario: r.scenarioId || r.scenario || "",
    });
  }
  return rows.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** Gather the whole console model. Never throws — down/unreachable is data. */
export async function gatherModel() {
  const up = runningContainers();
  const planes = Object.entries(PLANES).map(([name, members]) =>
    up ? { name, ...planeState(members, up) } : { name, tag: "unknown", detail: "", up: [] },
  );

  let incident = { reachable: false };
  try {
    const [alerts, p99] = await Promise.all([getAlerts(PROM), queryScalar(P99_EXPR, PROM)]);
    const firing = firingNames(alerts);
    const primaryFiring = firing.includes(PRIMARY_ALERT);
    incident = {
      reachable: true,
      p99ms: p99 == null ? null : Math.round(p99 * 1000),
      primary: PRIMARY_ALERT,
      primaryFiring,
      firing,
      suggest: primaryFiring ? "booklogr API p99 latency is high — investigate" : null,
    };
  } catch {
    incident = { reachable: false };
  }

  // Tag each deep-link with whether its service is actually up, so the UI can
  // grey out consoles that aren't running (a link to a down service is a dead end).
  const planeUp = (n) => planes.find((p) => p.name === n)?.tag === "up";
  const deployUp = planeUp("deploy"), forgeUp = planeUp("forge");
  const linkPlane = { Grafana: "deploy", Prometheus: "deploy", Alertmanager: "deploy", API: "deploy", web: "deploy", "Gitea (forge)": "forge" };
  const links = Object.entries(LINKS).map(([name, url]) => ({ name, url, up: linkPlane[name] === "forge" ? forgeUp : deployUp }));

  return { dockerReachable: up !== null, planes, incident, links, runs: recentRuns() };
}
