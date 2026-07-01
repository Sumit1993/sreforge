#!/usr/bin/env node
// =============================================================================
// console-serve.mjs — OPERATOR CONSOLE (ADR-0018 §1), auto-refreshing web page.
//
// Serves the same model as the CLI (console-model.mjs) as an HTML dashboard with
// clickable deep-links, refreshing every 5s. It binds 127.0.0.1 ONLY (loopback)
// and is never joined to a deploy network — so it is NOT agent-reachable, the
// ADR-0018 §1 guardrail. Reuse, don't rebuild: it deep-links the real UIs.
//   PORT (default 7420).  Run:  pnpm forge console booklogr SERVE=1
// =============================================================================
import { createServer } from "node:http";
import { gatherModel } from "./console-model.mjs";

const PORT = Number(process.env.PORT || 7420);
const HOST = "127.0.0.1"; // loopback ONLY — the never-agent-reachable guardrail.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CSS = `
  :root{--bg:#0f1117;--panel:#171a23;--ink:#e6e9ef;--dim:#9aa3b2;--line:#2a2f3c;
    --green:#4cc38a;--amber:#f0a63c;--red:#f0776a;--accent:#6ea8fe}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:22px 26px 50px}
  h1{font-size:20px;margin:0 0 2px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--dim);margin:22px 0 8px}
  .dim{color:var(--dim)} .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
  .row{display:flex;gap:14px;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:6px}
  .row>span:first-child{color:var(--dim);min-width:120px}
  .row>span:last-child{text-align:right}
  .pill{font-size:11px;font-weight:600;padding:1px 9px;border-radius:20px}
  .pill.up{background:#123024;color:var(--green);border:1px solid #1d5a41}
  .pill.down{background:#20242e;color:var(--dim);border:1px solid var(--line)}
  .pill.partial{background:#3a2c12;color:var(--amber);border:1px solid #7a5716}
  .pill.unknown{background:#20242e;color:var(--dim);border:1px solid var(--line)}
  .firing{color:var(--red);font-weight:700} .clear{color:var(--green)}
  .links{display:flex;flex-wrap:wrap;gap:8px}
  .link{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--accent);text-decoration:none;font-size:13px}
  .link:hover{border-color:#294066}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:5px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase}
  .v-pass{color:var(--green);font-weight:700} .v-fail{color:var(--red);font-weight:700}
  .badge{font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:2px 8px}
`;

function page(m) {
  const planes = m.dockerReachable
    ? m.planes.map((p) =>
        `<div class="row"><span>${esc(p.name)}</span><span><span class="pill ${p.tag}">${esc(p.tag)}${p.detail ? ` ${esc(p.detail)}` : ""}</span></span><span class="dim mono">${esc(p.up.join(", ")) || "—"}</span></div>`,
      ).join("")
    : `<div class="dim">docker unreachable — is the engine running?</div>`;

  const i = m.incident;
  const incident = !i.reachable
    ? `<div class="dim">Prometheus not reachable — deploy plane down or still coming up</div>`
    : `<div class="row"><span>p99 (30s)</span><span><b>${i.p99ms == null ? "n/a" : `${i.p99ms}ms`}</b> <span class="dim">(SLO 300ms)</span></span></div>
       <div class="row"><span>${esc(i.primary)}</span><span class="${i.primaryFiring ? "firing" : "clear"}">${i.primaryFiring ? "FIRING" : "clear"}</span></div>
       <div class="row"><span>firing</span><span>${i.firing.length ? esc(i.firing.join(", ")) : "(none)"}</span></div>
       ${i.suggest ? `<div class="row"><span>suggest prompt</span><span class="mono">"${esc(i.suggest)}"</span></div>` : ""}`;

  const links = Object.entries(m.links)
    .map(([n, u]) => `<a class="link" href="${esc(u)}" target="_blank" rel="noreferrer">${esc(n)} ↗</a>`).join("");

  const runs = m.runs.length === 0
    ? `<div class="dim">(none yet)</div>`
    : `<table><tr><th>run</th><th>verdict</th><th>score</th><th>scenario</th></tr>${
        m.runs.map((r) =>
          `<tr><td class="mono">${esc(r.runId)}</td><td class="${r.verdict === "passed" ? "v-pass" : "v-fail"}">${esc(r.verdict)}</td><td>${Number.isFinite(r.score) ? r.score.toFixed(2) : "—"}</td><td>${esc(r.scenario)}</td></tr>`,
        ).join("")
      }</table>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SREForge Operator Console — booklogr</title><style>${CSS}</style></head><body>
<h1>SREForge Operator Console — booklogr</h1>
<p class="dim">harness-side · <span class="badge">127.0.0.1 only · not agent-reachable</span> · auto-refresh 5s</p>
<h2>Planes</h2>${planes}
<h2>Incident</h2>${incident}
<h2>Deep links (the real UIs)</h2><div class="links">${links}</div>
<h2>Recent runs</h2>${runs}
<script>setTimeout(function(){location.reload()},5000)</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  try {
    const m = await gatherModel();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(m));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`console error: ${e.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`operator console (web) → http://${HOST}:${PORT}  (loopback only · not agent-reachable · Ctrl-C to stop)`);
});
