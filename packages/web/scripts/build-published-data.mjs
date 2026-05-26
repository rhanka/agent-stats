#!/usr/bin/env node
/**
 * Build the *published* dataset for the static dashboard from the user's own
 * local Claude Code + Codex sessions.
 *
 * Each local project path is relabelled to its **public git remote**
 * (owner/repo + URL), so the published JSON exposes no local username or
 * directory layout — only the public repositories the work already lives in.
 * Paths without a public remote fall back to their basename.
 *
 * Run locally (the machine that holds ~/.claude + ~/.codex), then commit the
 * generated files in packages/web/static/. CI cannot regenerate them.
 *
 *   node packages/web/scripts/build-published-data.mjs [--days 180]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../cli/dist/cli.js');
const staticDir = path.resolve(here, '../static');

const daysArg = process.argv.indexOf('--days');
const days = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 180;
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Resolve a local path to a public `owner/repo` + URL, or null. */
const repoCache = new Map();
function resolveRepo(cwd) {
  if (repoCache.has(cwd)) return repoCache.get(cwd);
  let result = null;
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    // git@host:owner/repo(.git)  |  https://host/owner/repo(.git)
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) {
      const slug = m[1];
      const host = url.includes('gitlab') ? 'gitlab.com' : 'github.com';
      result = { label: slug, url: `https://${host}/${slug}` };
    }
  } catch {
    /* no remote */
  }
  if (!result) {
    const base = cwd.replace(/\/+$/, '').split('/').pop() || cwd;
    result = { label: base, url: null };
  }
  repoCache.set(cwd, result);
  return result;
}

function relabel(rows) {
  for (const r of rows) {
    if (typeof r.projectCwd === 'string') {
      const repo = resolveRepo(r.projectCwd);
      r.projectCwd = repo.label;
      if (repo.url) r.repoUrl = repo.url;
    }
  }
  return rows;
}

const tmp = mkdtempSync(path.join(tmpdir(), 'agent-stats-pub-'));
function run(cmd) {
  // Write via the CLI's --out (clean writeFile) rather than capturing stdout,
  // which truncated on large outputs.
  const file = path.join(tmp, `${cmd}.json`);
  execFileSync('node', [cli, cmd, '--since', since, '--format', 'json', '--out', file], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return JSON.parse(readFileSync(file, 'utf8'));
}

console.error(`Building published data since ${since} (last ${days} days)…`);
const stats = relabel(run('stats'));
const anomalies = relabel(run('anomalies'));

writeFileSync(path.join(staticDir, 'published-stats.json'), JSON.stringify(stats));
writeFileSync(path.join(staticDir, 'published-anomalies.json'), JSON.stringify(anomalies));
writeFileSync(
  path.join(staticDir, 'published-meta.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), sinceDate: since, days }),
);

const repos = new Set(stats.map((r) => r.projectCwd));
console.error(
  `Wrote ${stats.length} stat rows, ${anomalies.length} anomalies, ${repos.size} projects.`,
);
