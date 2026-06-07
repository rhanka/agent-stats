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
 *   node packages/web/scripts/build-published-data.mjs --incremental [--incremental-days 3]
 *   node packages/web/scripts/build-published-data.mjs --incremental --refresh-anomalies
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { aggregateSessions, bucketBy, collect } from '@sentropic/agent-stats-core';

import {
  anonymize,
  buildPrivateMap,
  mergeAnomaliesByKey,
  mergeIncrementalRows,
  periodStartForIncremental,
  publicRepoFromRemote,
  scrubInvalidRepoRows,
} from './published-data-utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../cli/dist/cli.js');
const staticDir = path.resolve(here, '../static');

function numberArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const n = Number(process.argv[idx + 1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: ${process.argv[idx + 1]}`);
  return n;
}

const days = numberArg('--days', 420);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const incremental = process.argv.includes('--incremental');
const incrementalDays = numberArg('--incremental-days', 3);
const refreshAnomalies = !incremental || process.argv.includes('--refresh-anomalies');
const incrementalSince = periodStartForIncremental(new Date(), incrementalDays);
const statsSince = incremental ? incrementalSince : since;

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
    result = publicRepoFromRemote(url);
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

/** Merge stat rows that collapse to the same (week, repo, tool, model) after
 *  relabelling (e.g. a repo and its worktree). */
function mergeStats(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = [r.weekStart, r.projectCwd, r.tool, r.model].join('|');
    const a = m.get(k);
    if (!a) {
      m.set(k, structuredClone(r));
      continue;
    }
    a.sessions += r.sessions;
    a.turns += r.turns;
    for (const f of Object.keys(a.totalUsage)) a.totalUsage[f] += r.totalUsage[f] ?? 0;
    a.estimatedCost.codexCredits += r.estimatedCost.codexCredits;
    a.estimatedCost.claudeUsdCents += r.estimatedCost.claudeUsdCents;
    a.estimatedCost.unknown += r.estimatedCost.unknown;
    if (r.rateLimitMax) {
      a.rateLimitMax ??= { primaryPercent: 0, secondaryPercent: 0 };
      a.rateLimitMax.primaryPercent = Math.max(
        a.rateLimitMax.primaryPercent,
        r.rateLimitMax.primaryPercent,
      );
      a.rateLimitMax.secondaryPercent = Math.max(
        a.rateLimitMax.secondaryPercent,
        r.rateLimitMax.secondaryPercent,
      );
    }
    if (!a.repoUrl && r.repoUrl) a.repoUrl = r.repoUrl;
  }
  return [...m.values()];
}

const tmp = mkdtempSync(path.join(tmpdir(), 'agent-stats-pub-'));

function run(cmd, extraArgs = [], sinceDate = since) {
  // Write via the CLI's --out (clean writeFile) rather than capturing stdout,
  // which truncated on large outputs.
  const file = path.join(tmp, `${cmd}-${extraArgs.join('') || 'w'}.json`);
  execFileSync(
    'node',
    [cli, cmd, '--since', sinceDate, '--format', 'json', ...extraArgs, '--out', file],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return JSON.parse(readFileSync(file, 'utf8'));
}

const DAILY_DAYS = 65; // cover the 60-day daily window with margin
const dailySince = new Date(Date.now() - DAILY_DAYS * 86_400_000).toISOString().slice(0, 10);
const dailyRunSince = incremental ? statsSince : dailySince;

function readPublished(name) {
  const file = path.join(staticDir, name);
  if (!existsSync(file)) return [];
  return scrubInvalidRepoRows(JSON.parse(readFileSync(file, 'utf8')));
}

async function buildIncrementalStats(sinceDate) {
  const sessions = await aggregateSessions(collect({ since: new Date(sinceDate) }));
  return {
    weekly: bucketBy(sessions, 'week'),
    daily: bucketBy(sessions, 'day'),
  };
}

console.error(
  incremental
    ? `Building incremental published data since ${statsSince} (last ${incrementalDays} days, snapped to week)…`
    : `Building published data since ${since} (last ${days} days)…`,
);

let stats;
let daily;
if (incremental) {
  const recent = await buildIncrementalStats(statsSince);
  stats = mergeStats(relabel(recent.weekly));
  daily = mergeStats(relabel(recent.daily));
} else {
  stats = mergeStats(relabel(run('stats', [], statsSince)));
  // Daily granularity for the recent window (powers the <30d chart on the static site).
  daily = mergeStats(relabel(run('stats', ['--granularity', 'day'], dailyRunSince)));
}
let anomalies = refreshAnomalies
  ? relabel(run('anomalies', [], statsSince))
  : readPublished('published-anomalies.json');

if (incremental) {
  stats = mergeIncrementalRows(readPublished('published-stats.json'), stats, statsSince);
  daily = mergeIncrementalRows(
    readPublished('published-daily.json').filter((row) => row.weekStart >= dailySince),
    daily,
    statsSince,
  );
  if (refreshAnomalies) {
    anomalies = mergeAnomaliesByKey(readPublished('published-anomalies.json'), anomalies);
  }
}

// Never publish a private/local project name: collapse non-public projects to
// stable "private-N" buckets (shared across all datasets).
const privMap = buildPrivateMap([...stats, ...daily, ...anomalies]);
anonymize(stats, privMap);
anonymize(anomalies, privMap);
anonymize(daily, privMap);

writeFileSync(path.join(staticDir, 'published-stats.json'), JSON.stringify(stats));
writeFileSync(path.join(staticDir, 'published-daily.json'), JSON.stringify(daily));
writeFileSync(path.join(staticDir, 'published-anomalies.json'), JSON.stringify(anomalies));
writeFileSync(
  path.join(staticDir, 'published-meta.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sinceDate: since,
    days,
    dailySinceDate: dailySince,
    dailyDays: DAILY_DAYS,
    dailyRefreshSinceDate: dailyRunSince,
    incremental,
    anomaliesRefreshed: refreshAnomalies,
    ...(incremental ? { incrementalSinceDate: statsSince, incrementalDays } : {}),
  }),
);

const repos = new Set(stats.map((r) => r.projectCwd));
console.error(
  `Wrote ${stats.length} weekly rows, ${daily.length} daily rows, ${anomalies.length} anomalies, ${repos.size} projects.`,
);
