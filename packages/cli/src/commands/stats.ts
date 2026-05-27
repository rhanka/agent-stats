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
  tool?: 'claude' | 'codex' | 'cursor';
  project?: string;
  format?: 'json' | 'table';
  /** Override default scan dirs (used by tests). */
  claudeProjectsDir?: string;
  codexDbPath?: string;
  cursorStateDir?: string;
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

/**
 * Format the estimated cost of a row in its native currency:
 *   - Codex → credits (`cr`), the actual quota currency.
 *   - Claude → notional API-equivalent dollars (`~$`). On a flat-rate Max
 *     plan this is NOT real spend — it's the pay-as-you-go list price the
 *     same tokens would have cost, shown only for cross-tool comparison.
 */
function formatCost(r: WeeklyAggregation): string {
  if (r.estimatedCost.codexCredits > 0) return `${r.estimatedCost.codexCredits.toFixed(1)} cr`;
  if (r.estimatedCost.claudeUsdCents > 0) return `~$${(r.estimatedCost.claudeUsdCents / 100).toFixed(2)}`;
  return '-';
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
      formatCost(r),
    ]);
  }
  // compute column widths
  const widths = headers.map((_, i) => Math.max(...lines.map((l) => (l[i] ?? '').length)));
  const fmt = (l: string[]): string =>
    l.map((c, i) => (i === 2 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ');
  const out = [fmt(lines[0] ?? []), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (let i = 1; i < lines.length; i++) out.push(fmt(lines[i] ?? []));
  out.push('', renderSummary(rows));
  return out.join('\n');
}

/**
 * Honest headline below the table: total Codex credits, the peak rate-limit
 * window usage actually observed (the real "how much quota did I burn"), and
 * the notional Claude API-equivalent — clearly labelled as such.
 */
function renderSummary(rows: WeeklyAggregation[]): string {
  let credits = 0;
  let usdCents = 0;
  let peak5h = 0;
  let peak7d = 0;
  for (const r of rows) {
    credits += r.estimatedCost.codexCredits;
    usdCents += r.estimatedCost.claudeUsdCents;
    if (r.rateLimitMax) {
      peak5h = Math.max(peak5h, r.rateLimitMax.primaryPercent);
      peak7d = Math.max(peak7d, r.rateLimitMax.secondaryPercent);
    }
  }
  const parts = [
    `Codex: ${credits.toFixed(0)} credits`,
    `Codex quota peak observed: 5h ${peak5h.toFixed(0)}% · 7d ${peak7d.toFixed(0)}%`,
    `Claude: ~$${(usdCents / 100).toFixed(2)} (API-equiv, notional on flat-rate Max)`,
  ];
  return [
    'Summary',
    '  ' + parts.join('\n  '),
    '  Note: `cached` tokens include cache replay (a long parent thread re-billed',
    '  at each subagent fork), which inflates volume without new reasoning.',
  ].join('\n');
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
  if (opts.cursorStateDir !== undefined) collectOpts.cursorStateDir = opts.cursorStateDir;
  if (opts.tool) {
    collectOpts.sources = {
      claude: opts.tool === 'claude',
      codex: opts.tool === 'codex',
      cursor: opts.tool === 'cursor',
    };
  }
  const rows = await aggregateWeekly(collect(collectOpts));
  const format = opts.format ?? 'json';
  const output = format === 'table' ? renderTable(rows) : JSON.stringify(rows, null, 2);
  return { output, rows };
}
