#!/usr/bin/env node
// =============================================================================
// verify-mcp.mjs — assert the MCP TELEMETRY SEAM (ADR-0018 §3).
//
// WHAT THIS IS
//   Companion to verify-egress.sh / verify-boundary.sh, for the MCP seam
//   (compose/mcp.yml — the read-only Grafana MCP server). It connects as a plain
//   MCP client and proves the seam is:
//     1. SCOPED       — only observability-read tool groups are exposed
//                       (datasource / prometheus / alerting / dashboard).
//     2. READ-ONLY    — no write operation is reachable (-disable-write strips
//                       create/update/delete from the manage tools' enums).
//     3. github-SAFE  — no tool accepts an arbitrary URL/host, so an MCP-only
//                       agent has no tool to reach github (capability-bounded;
//                       ADR-0013 retrieval isolation holds by construction).
//     4. ALERT-LIVE   — the firing alert is self-servable via PromQL (ALERTS),
//                       so an MCP-only agent can still discover the incident
//                       the ADR-0022 way.
//     5. METRICS-LIVE — PromQL queries return data through the seam.
//
//   NO model calls — this is a pure MCP client, so it costs nothing to run.
//   Requires the deploy plane armed (an incident firing) for checks 4-5, and the
//   MCP overlay up (`pnpm forge mcp booklogr`).
//
//   PASS/FAIL per check; exits non-zero on any failure.
//
// CONFIG (env):
//   MCP_URL       default http://127.0.0.1:8009/mcp  (the dev-published seam port)
//   PROM_DS_UID   default prometheus                 (the Grafana datasource uid)
//   EXPECT_ALERT  default BooklogrApiLatencyP99High  (the armed scenario's alert)
// =============================================================================
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:8009/mcp";
const DS = process.env.PROM_DS_UID || "prometheus";
const EXPECT_ALERT = process.env.EXPECT_ALERT || "BooklogrApiLatencyP99High";

let fails = 0;
const pass = (m) => console.log("  PASS  " + m);
const fail = (m) => { console.log("  FAIL  " + m); fails++; };
const hdr = (m) => console.log("\n== " + m + " ==");
const text = (r) => (r.content || []).map((c) => c.text || "").join("\n");

const client = new Client({ name: "sreforge-verify-mcp", version: "0.0.2" }, { capabilities: {} });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
} catch (e) {
  console.log("  FAIL  cannot connect to MCP server at " + MCP_URL + " — is `pnpm forge mcp booklogr` up? " + e.message);
  process.exit(1);
}

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

hdr("1. SCOPED SURFACE (only observability-read tool groups)");
for (const need of ["list_datasources", "query_prometheus"]) {
  names.includes(need) ? pass("tool present: " + need) : fail("missing expected tool: " + need);
}
const forbidden = ["loki", "incident", "oncall", "admin", "config", "provision", "sift", "pyroscope", "snapshot", "annotation", "folder", "navigation"];
const leaked = names.filter((n) => forbidden.some((g) => n.toLowerCase().includes(g)));
leaked.length === 0
  ? pass(`no out-of-scope tools (${names.length} tools, all datasource/prometheus/alerting/dashboard)`)
  : fail("out-of-scope tools leaked: " + leaked.join(","));

hdr("2. READ-ONLY (no write operation reachable)");
const writeWords = /create|update|delete|write|post|put|patch|remove|silence|pause|\badd\b|\bset\b/i;
const writeFound = [];
for (const t of tools) {
  if (writeWords.test(t.name)) writeFound.push(t.name);
  const en = t.inputSchema?.properties?.operation?.enum;
  if (Array.isArray(en)) {
    const w = en.filter((v) => writeWords.test(v));
    if (w.length) writeFound.push(`${t.name}.operation:[${w.join(",")}]`);
  }
}
writeFound.length === 0
  ? pass("no write operations exposed (manage tools are list/get/versions only)")
  : fail("write ops reachable: " + writeFound.join(" "));

hdr("3. github-SAFE (no tool accepts an arbitrary URL/host)");
const urlTools = tools.filter((t) =>
  Object.keys(t.inputSchema?.properties || {}).some((k) => /^url$|uri|endpoint|^host$/i.test(k)),
);
urlTools.length === 0
  ? pass("no tool accepts an arbitrary URL/host — Grafana-scoped only, no path to github")
  : fail("tool(s) accept a URL/host: " + urlTools.map((t) => t.name).join(","));

hdr("4. FIRING ALERT VISIBLE (agent can self-serve the incident)");
try {
  const r = await client.callTool({
    name: "query_prometheus",
    arguments: { datasourceUid: DS, expr: `ALERTS{alertstate="firing"}`, queryType: "instant", endTime: "now" },
  });
  const body = text(r);
  body.includes(EXPECT_ALERT)
    ? pass("firing alert self-servable via PromQL ALERTS: " + EXPECT_ALERT)
    : fail(`expected firing alert '${EXPECT_ALERT}' not found (is the incident armed?). Got: ${body.slice(0, 300)}`);
} catch (e) { fail("ALERTS query failed: " + e.message); }

hdr("5. METRICS READABLE (PromQL through the seam)");
try {
  const expr = `histogram_quantile(0.99, sum by (le)(rate(flask_http_request_duration_seconds_bucket{job="booklogr-api"}[5m])))`;
  const r = await client.callTool({
    name: "query_prometheus",
    arguments: { datasourceUid: DS, expr, queryType: "instant", endTime: "now" },
  });
  const body = text(r);
  !r.isError && /\d/.test(body)
    ? pass("PromQL p99 query returned data through the seam")
    : fail("p99 query returned no data: " + body.slice(0, 200));
} catch (e) { fail("p99 query failed: " + e.message); }

await client.close();

hdr("VERDICT");
if (fails === 0) {
  console.log("  MCP SEAM OK — read-only, scoped, telemetry reachable, github-unreachable.\n");
  process.exit(0);
}
console.log(`  MCP SEAM BREACHED — ${fails} failing check(s). See FAIL lines above.\n`);
process.exit(1);
