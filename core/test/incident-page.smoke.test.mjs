// Smoke test for the incident page (IncidentPageRenderer) — a de-tell regression guard.
//
// The brief is the agent's whole view at t=0, so its content is load-bearing for
// the de-tell boundary: it must read like a real on-call page and must never leak
// the rig. This test pins the properties that matter and would silently rot
// otherwise. Zero-dependency: built-in node:test against the compiled module.
//
//   npm test   # (builds first, then runs this)

import test from "node:test";
import assert from "node:assert/strict";
import { IncidentPageRenderer } from "../dist/index.js";

// A trigger whose contents we assert DO NOT reach the agent: the agent picks the
// firing alert up from the alerting stack itself, it is not spoon-fed here.
const trigger = {
  source: "prometheus-alert",
  alertName: "BooklogrApiLatencyP99High",
  severity: "critical",
  labels: { service: "booklogr-api", severity: "critical" },
  annotations: {
    summary: "High p99 request latency on booklogr-api",
    description: "p99 latency is 812ms (threshold 300ms).",
  },
  firedAt: "2026-06-25T10:15:30Z",
};

// Agent-facing context: in-network DNS endpoints + the in-sandbox source path.
// runWorkspace.path is the HOST substrate (engine-only) and must never surface.
const context = {
  services: {
    alertmanager: "http://alertmanager:9093",
    prometheus: "http://prometheus:9090",
    grafana: "http://grafana:3000",
    "booklogr-api": "http://booklogr-api:5000",
  },
  runWorkspace: {
    path: "/home/sumit/sources/sreforge-workspace/sreforge/use-cases/booklogr/stacks/flask-compose/substrate/booklogr",
    service: "booklogr-api",
  },
  workspacePath: "/workspace",
  submitCommand: "submit",
};

test("brief never leaks the rig (de-tell properties)", () => {
  const { prompt } = new IncidentPageRenderer().render(trigger, context);
  const lower = prompt.toLowerCase();

  // 1. No host-facing endpoints — the agent is inside the deploy network.
  assert.ok(!lower.includes("localhost"), "brief must not mention localhost");
  assert.ok(!lower.includes("127.0.0.1"), "brief must not mention 127.0.0.1");

  // 2. No host filesystem path — the agent only knows its in-sandbox mount.
  assert.ok(!prompt.includes("/home/"), "brief must not leak a host home path");
  assert.ok(!prompt.includes("/srv/"), "brief must not leak the neutral host cover path");
  assert.ok(!lower.includes("substrate"), "brief must not name the substrate");

  // 3. No spoon-fed diagnosis — the agent reads the alert off Alertmanager.
  assert.ok(!prompt.includes(trigger.alertName), "brief must not name the firing alert");
  assert.ok(!prompt.includes(trigger.annotations.summary), "brief must not restate the alert summary");
  assert.ok(!/\bsummary:/i.test(prompt), "brief must not have a Summary: line");
  assert.ok(!/\bsince:/i.test(prompt), "brief must not have a Since: line");

  // 4. No harness/eval framing (D8 — honest, neutral).
  for (const tell of ["sreforge", "harness", "scenario", "inject", "baseline", "answer", "evaluation", "correct fix"]) {
    assert.ok(!lower.includes(tell), `brief must not contain the tell "${tell}"`);
  }
});

test("brief gives the agent what it needs to self-serve", () => {
  const { prompt, alertName } = new IncidentPageRenderer().render(trigger, context);

  // Points at the alerting stack as the source of truth, by reachable DNS.
  assert.ok(prompt.includes("alertmanager"), "brief must point at the alerting stack");
  assert.ok(prompt.includes("http://alertmanager:9093"), "brief must give the in-network alertmanager URL");
  assert.ok(prompt.includes("http://prometheus:9090"), "brief must give the in-network prometheus URL");

  // The agent's own working directory + handback command + which service it owns.
  assert.ok(prompt.includes("/workspace"), "brief must show the in-sandbox source path");
  assert.ok(prompt.includes("submit"), "brief must name the submit command");
  assert.ok(prompt.includes("booklogr-api"), "brief must name the service the agent owns");

  // The firing alert is preserved as structured metadata for the runner, even
  // though it is intentionally absent from the rendered page.
  assert.equal(alertName, trigger.alertName, "alertName metadata is preserved on the brief");
});

test("workspacePath defaults to /workspace without leaking the substrate", () => {
  const { workspacePath, ...rest } = context; // omit workspacePath
  void workspacePath;
  const { prompt } = new IncidentPageRenderer().render(trigger, rest);
  assert.ok(prompt.includes("/workspace"), "defaults to /workspace when omitted");
  assert.ok(!prompt.includes("/home/"), "default must not fall back to the host substrate path");
});
