#!/usr/bin/env node
// =============================================================================
// usecase — the neutral use-case dispatcher.
//
// Invoked as `pnpm forge <verb> <use-case> [args…]`. The VERB is the stable,
// use-case-neutral vocabulary (setup, up, arm, agent, run, verify, down, …);
// the USE-CASE is a parameter. So nothing at the engine/root layer ever names a
// specific use-case — adding one is `mkdir use-cases/<name>/…`, no new script.
//
// Why a dispatcher and not bare `pnpm <verb>` or go-task namespaces:
//   • `pnpm up` aliases `pnpm update`, `pnpm setup` configures pnpm itself, and
//     `pnpm run` is reserved — bare verb scripts get hijacked by pnpm.
//   • go-task's native `includes:` gives `task booklogr:setup` — namespace-FIRST,
//     i.e. use-case-first again, the very thing we're removing.
// So this ~40-line shim sits above the real worker (go-task) and gives a neutral
// verb-first surface. go-task still does all the actual lifecycle work, per the
// stack's own Taskfile.yml.
//
//   pnpm forge <verb>      <use-case>[:<stack>]  [task-args…]
//   pnpm forge setup       booklogr
//   pnpm forge run         booklogr  RUNNER=external id=r1
//   pnpm forge incident    booklogr                       # a composite
//   pnpm forge menu        booklogr                       # list the stack's phases
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Per-run phase verbs → the task each maps to in a stack's Taskfile. Identity
// for now (the Taskfile uses the same names); kept explicit so the neutral
// vocabulary is the contract, not the Taskfile's task names.
const PHASE_TASK = {
  setup: "setup",
  up: "up",
  arm: "arm",
  agent: "agent",
  mcp: "mcp", //                             optional MCP telemetry seam (read-only Grafana MCP)
  run: "run",
  verify: "verify",
  down: "down",
  status: "status",
  smoke: "smoke",
};

// Composite verbs → the ordered phase verbs they expand to. Trailing task-args
// (e.g. RUNNER=external) flow only to the `run` phase inside a composite.
const COMPOSITES = {
  fresh: ["setup", "up"], //               first-time cold bring-up
  "agent-up": ["arm", "agent"], //         arm + sandbox, ready to exec a real agent in
  incident: ["arm", "run", "verify"], //   one graded run on an already-up stack
  e2e: ["setup", "up", "arm", "run", "verify", "down"], // cold-start → teardown
};

function die(msg) {
  process.stderr.write(`forge: ${msg}\n`);
  process.exit(1);
}

function usage() {
  const phases = Object.keys(PHASE_TASK).join(", ");
  const composites = Object.keys(COMPOSITES).join(", ");
  process.stderr.write(
    [
      "usage: pnpm forge <verb> <use-case>[:<stack>] [task-args…]",
      "",
      `  phases:     ${phases}`,
      `  composites: ${composites}`,
      "  menu:       pnpm forge menu <use-case>   # list a stack's phases",
      "",
      "  e.g.  pnpm forge up booklogr",
      "        pnpm forge run booklogr RUNNER=external id=r1",
      "        pnpm forge incident booklogr",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

/** Resolve `<use-case>[:<stack>]` to its stack directory. */
function resolveStack(ref) {
  const [name, stack] = ref.split(":");
  const stacksDir = resolve(REPO_ROOT, "use-cases", name, "stacks");
  if (!existsSync(stacksDir)) die(`unknown use-case '${name}' (no ${stacksDir})`);
  const stacks = readdirSync(stacksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (stacks.length === 0) die(`use-case '${name}' has no stacks under ${stacksDir}`);
  if (stack) {
    if (!stacks.includes(stack)) {
      die(`use-case '${name}' has no stack '${stack}' (have: ${stacks.join(", ")})`);
    }
    return resolve(stacksDir, stack);
  }
  if (stacks.length > 1) {
    die(`use-case '${name}' has multiple stacks (${stacks.join(", ")}); address one as ${name}:<stack>`);
  }
  return resolve(stacksDir, stacks[0]);
}

/** Run one Taskfile task in the stack dir via the pinned go-task binary. */
function runTask(stackDir, task, taskArgs) {
  const local = resolve(REPO_ROOT, "node_modules", ".bin", "task");
  const bin = existsSync(local) ? local : "task";
  const res = spawnSync(bin, ["--dir", stackDir, task, ...taskArgs], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });
  if (res.error) die(`could not run task: ${res.error.message}`);
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const [verb, ref, ...rest] = process.argv.slice(2);
if (!verb || verb === "help" || verb === "--help" || verb === "-h") usage();
if (!ref) die(`'${verb}' needs a use-case: pnpm forge ${verb} <use-case>`);

const stackDir = resolveStack(ref);

if (verb === "menu" || verb === "list") {
  runTask(stackDir, "--list", []);
} else if (COMPOSITES[verb]) {
  for (const phase of COMPOSITES[verb]) {
    runTask(stackDir, PHASE_TASK[phase], phase === "run" ? rest : []);
  }
} else if (PHASE_TASK[verb]) {
  runTask(stackDir, PHASE_TASK[verb], rest);
} else {
  die(`unknown verb '${verb}'`);
}
