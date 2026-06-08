#!/usr/bin/env node
// Contamination guard — scans a SREForge *substrate* repo for tells that would
// reveal to an agent-under-test that the app is a planted-fault evaluation rig.
// Enforces D8 (de-tell) + D12 (physical separation) as a build gate, not a doc.
//
// Usage:  node tools/contamination-guard/scan.mjs [options] <target-dir...>
//   --strict          treat soft-tells (WARN) as failures too
//   --policy <path>   use an alternate policy.json
//   --max <n>         cap findings printed per rule (default 15)
//   --json            emit machine-readable JSON instead of a report
//
// Exit code: 1 if any BLOCK finding (or any WARN under --strict), else 0.
// This tool lives in the harness and scans a substrate dir as an external
// target. It is NEVER copied into a substrate repo — a contamination scanner
// sitting inside the app would itself be the loudest tell.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { strict: false, json: false, max: 15, policy: join(HERE, 'policy.json'), targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--policy') opts.policy = argv[++i];
    else if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    else opts.targets.push(a);
  }
  if (opts.targets.length === 0) opts.targets.push(process.cwd());
  return opts;
}

function fail(msg) {
  process.stderr.write(`contamination-guard: ${msg}\n`);
  process.exit(2);
}

function loadPolicy(path) {
  if (!existsSync(path)) fail(`policy not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const compile = (rules) => rules.map((r) => ({ ...r, re: new RegExp(r.pattern, 'gi') }));
  return {
    hardTells: compile(raw.hardTells || []),
    softTells: compile(raw.softTells || []),
    forbiddenDirs: new Set(raw.forbiddenDirs || []),
    forbiddenFiles: new Set(raw.forbiddenFiles || []),
    ignoreDirs: new Set(raw.ignoreDirs || []),
    ignoreFiles: new Set(raw.ignoreFiles || []),
    ignoreExtensions: new Set(raw.ignoreExtensions || []),
    allowList: (raw.allowList || []).map((p) => new RegExp(p, 'i')),
  };
}

// Recursively collect scannable files, recording structural violations as we go.
function walk(root, policy, findings) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      const rel = relative(root, full) || ent.name;
      if (ent.isDirectory()) {
        if (policy.ignoreDirs.has(ent.name)) continue;
        if (policy.forbiddenDirs.has(ent.name)) {
          findings.push({ tier: 'BLOCK', rule: 'forbidden-dir', file: rel + sep, line: 0,
            text: `directory '${ent.name}/' is harness-only and must not exist in substrate`, message: 'Harness directory present in substrate.' });
        }
        stack.push(full);
      } else if (ent.isFile()) {
        if (policy.forbiddenFiles.has(ent.name)) {
          findings.push({ tier: 'BLOCK', rule: 'forbidden-file', file: rel, line: 0,
            text: `file '${ent.name}' is a harness artifact and must not ship in substrate`, message: 'Harness file present in substrate.' });
          continue; // don't also content-scan a file we already reject
        }
        if (policy.ignoreFiles.has(ent.name)) continue;
        if (policy.ignoreExtensions.has(extname(ent.name).toLowerCase())) continue;
        out.push({ full, rel });
      }
    }
  }
  return out;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanFile(file, policy, findings) {
  let buf;
  try { buf = readFileSync(file.full); } catch { return; }
  if (isBinary(buf)) return;
  const lines = buf.toString('utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (policy.allowList.some((re) => re.test(line))) continue;
    matchTier(line, policy.hardTells, 'BLOCK', file.rel, i + 1, findings);
    matchTier(line, policy.softTells, 'WARN', file.rel, i + 1, findings);
  }
}

function matchTier(line, rules, tier, rel, lineNo, findings) {
  for (const r of rules) {
    r.re.lastIndex = 0;
    const m = r.re.exec(line);
    if (m) {
      findings.push({ tier, rule: r.id, file: rel, line: lineNo,
        text: snippet(line, m.index, m[0].length), message: r.message });
    }
  }
}

function snippet(line, idx, len) {
  const start = Math.max(0, idx - 24);
  const end = Math.min(line.length, idx + len + 24);
  const pre = (start > 0 ? '…' : '') + line.slice(start, idx);
  const hit = line.slice(idx, idx + len);
  const post = line.slice(idx + len, end) + (end < line.length ? '…' : '');
  return `${pre}[${hit}]${post}`.trim();
}

// Git history is part of the substrate an agent can read (git log). Per D8 the
// history must be fresh — scan author/subject/body for hard tells.
function scanGitHistory(root, policy, findings) {
  if (!existsSync(join(root, '.git'))) return;
  let log;
  try {
    log = execFileSync('git', ['-C', root, 'log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%s%x1f%b%x1e'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { return; }
  for (const commit of log.split('\x1e')) {
    if (!commit.trim()) continue;
    const [hash, an, ae, subject, body] = commit.replace(/^\n/, '').split('\x1f');
    const hay = `${an} ${ae} ${subject} ${body || ''}`;
    for (const r of policy.hardTells) {
      r.re.lastIndex = 0;
      const m = r.re.exec(hay);
      if (m) {
        findings.push({ tier: 'BLOCK', rule: `git-history:${r.id}`, file: '<git history>',
          line: 0, text: `${(hash || '').slice(0, 8)} — ${snippet(hay, m.index, m[0].length)}`,
          message: 'Tell in commit history. Substrate needs a fresh git init (D8).' });
      }
    }
  }
}

function report(targetResults, opts) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(targetResults, null, 2) + '\n');
    return;
  }
  let totalBlock = 0, totalWarn = 0;
  for (const { target, findings } of targetResults) {
    const blocks = findings.filter((f) => f.tier === 'BLOCK');
    const warns = findings.filter((f) => f.tier === 'WARN');
    totalBlock += blocks.length; totalWarn += warns.length;
    process.stdout.write(`\n━━ ${target}\n`);
    if (!findings.length) { process.stdout.write('   ✓ clean — no tells, no harness artifacts, history clear\n'); continue; }
    printGroup('⛔ BLOCK', blocks, opts.max);
    printGroup('⚠️  WARN', warns, opts.max);
  }
  process.stdout.write(`\n${'─'.repeat(60)}\n`);
  process.stdout.write(`Summary: ${totalBlock} block, ${totalWarn} warn across ${targetResults.length} target(s)\n`);
  const failed = totalBlock > 0 || (opts.strict && totalWarn > 0);
  process.stdout.write(failed ? '✗ FAIL — substrate would leak its nature to an agent.\n' : '✓ PASS — substrate looks like an ordinary product.\n');
}

function printGroup(title, items, max) {
  if (!items.length) return;
  const byRule = new Map();
  for (const f of items) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
  process.stdout.write(`   ${title}  (${items.length})\n`);
  for (const [rule, fs] of byRule) {
    process.stdout.write(`   · ${rule} — ${fs[0].message}\n`);
    for (const f of fs.slice(0, max)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      process.stdout.write(`       ${loc}  ${f.text}\n`);
    }
    if (fs.length > max) process.stdout.write(`       … +${fs.length - max} more\n`);
  }
}

// --- main ---
const opts = parseArgs(process.argv.slice(2));
const policy = loadPolicy(opts.policy);
const targetResults = opts.targets.map((target) => {
  if (!existsSync(target)) fail(`target not found: ${target}`);
  const findings = [];
  const root = statSync(target).isDirectory() ? target : dirname(target);
  const files = walk(root, policy, findings);
  for (const f of files) scanFile(f, policy, findings);
  scanGitHistory(root, policy, findings);
  return { target, findings };
});
report(targetResults, opts);
const failed = targetResults.some(({ findings }) =>
  findings.some((f) => f.tier === 'BLOCK') || (opts.strict && findings.some((f) => f.tier === 'WARN')));
process.exit(failed ? 1 : 0);
