#!/usr/bin/env node
// =============================================================================
// provider-egress.mjs — resolve a model PROVIDER name to its egress allowlist.
//
// ADR-0018 §2 (reframed 2026-07-01): a run OPTS IN to an optional model provider;
// the use-case does not negotiate with the agent. This maps the selected provider
// to the host(s) the sandbox egress allowlist should permit, from the registry
// at infra/agent-sandbox/providers.json.
//
//   node tools/provider-egress.mjs anthropic   -> prints "api.anthropic.com"
//   node tools/provider-egress.mjs local       -> prints "" (zero external egress)
//   node tools/provider-egress.mjs bogus       -> exit 1 (fail closed; no open egress)
//
// The Taskfile `agent` task consumes stdout as EGRESS_ALLOWLIST. Enforcement is
// the firewall (init-firewall.sh); this only NAMES what a run allows out.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_PATH = resolve(HERE, "..", "infra", "agent-sandbox", "providers.json");

const name = (process.argv[2] || "").trim();
if (!name) {
  process.stderr.write("usage: provider-egress.mjs <provider>\n");
  process.exit(2);
}

let providers;
try {
  providers = JSON.parse(readFileSync(REG_PATH, "utf8")).providers || {};
} catch (e) {
  process.stderr.write(`provider-egress: cannot read registry ${REG_PATH}: ${e.message}\n`);
  process.exit(2);
}

if (!(name in providers)) {
  process.stderr.write(
    `provider-egress: unknown provider '${name}'. Known: ${Object.keys(providers).join(", ")}\n`,
  );
  process.exit(1); // fail closed — never fall through to open/zero egress silently
}

process.stdout.write((providers[name].egress || []).join(","));
