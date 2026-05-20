/**
 * `agent-stats stats` — emit weekly aggregations as JSON or as a compact
 * ASCII table.
 */

import {
  aggregateWeekly,
  collect,
  type CollectOptions,
  type WeeklyAggregation,
} from '@sentropic/agent-stats-core';

export interface StatsCommandOptions {
  since?: string; // ISO date
  until?: string; // ISO date
  tool?: 'claude' | 'codex';
  project?: string;
  format?: 'json' | 'table';
  /** Override default scan dirs (used by tests). */
  claudeProjectsDir?: string;
  codexDbPath?: string;
}

export interface StatsResult {
  output: string;
  rows: WeeklyAggregation[];
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --${label} value: ${value} (expected ISO 8601)`);
  }
  return d;
}

function renderTable(rows: WeeklyAggregation[]): string {
  if (rows.length === 0) return '(no data)';
  const headers = [
    'week',
    'tool',
    'project',
    'model',
    'sess',
    'turns',
    'in',
    'cached',
    'out',
    'cost',
  ];
  const lines: string[][] = [headers];
  for (const r of rows) {
    const cost =
      r.estimatedCost.codexCredits > 0
        ? `${r.estimatedCost.codexCredits.toFixed(1)} cr`
        : r.estimatedCost.claudeUsdCents > 0
          ? `$${(r.estimatedCost.claudeUsdCents / 100).toFixed(2)}`
          : '-';
    lines.push([
      r.weekStart,
      r.tool,
      r.projectCwd,
      r.model,
      String(r.sessions),
      String(r.turns),
      String(r.totalUsage.newInputTokens),
      String(r.totalUsage.cachedInputTokens),
      String(r.totalUsage.outputTokens),
      cost,
    ]);
  }
  // compute column widths
  const widths = headers.map((_, i) => Math.max(...lines.map((l) => (l[i] ?? '').length)));
  const fmt = (l: string[]): string =>
    l.map((c, i) => (i === 2 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ');
  const out = [fmt(lines[0] ?? []), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (let i = 1; i < lines.length; i++) out.push(fmt(lines[i] ?? []));
  return out.join('\n');
}

export async function runStats(opts: StatsCommandOptions = {}): Promise<StatsResult> {
  const collectOpts: CollectOptions = {};
  const since = parseDate(opts.since, 'since');
  const until = parseDate(opts.until, 'until');
  if (since !== undefined) collectOpts.since = since;
  if (until !== undefined) collectOpts.until = until;
  if (opts.project !== undefined) collectOpts.projectCwd = opts.project;
  if (opts.claudeProjectsDir !== undefined) collectOpts.claudeProjectsDir = opts.claudeProjectsDir;
  if (opts.codexDbPath !== undefined) collectOpts.codexDbPath = opts.codexDbPath;
  if (opts.tool) {
    collectOpts.sources = {
      claude: opts.tool === 'claude',
      codex: opts.tool === 'codex',
    };
  }
  const rows = await aggregateWeekly(collect(collectOpts));
  const format = opts.format ?? 'json';
  const output = format === 'table' ? renderTable(rows) : JSON.stringify(rows, null, 2);
  return { output, rows };
}
