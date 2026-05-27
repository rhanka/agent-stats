/**
 * `agent-stats report` — render a Markdown weekly report from the
 * aggregations. Highlights top projects, top models, cache efficiency,
 * and (when present) rate-limit pressure.
 */

import {
  aggregateWeekly,
  cacheEfficiency,
  collect,
  totalInputTokens,
  type CollectOptions,
  type WeeklyAggregation,
} from '@sentropic/agent-stats-core';

export interface ReportCommandOptions {
  since?: string;
  until?: string;
  tool?: 'claude' | 'codex' | 'cursor';
  project?: string;
  top?: number;
  claudeProjectsDir?: string;
  codexDbPath?: string;
  cursorStateDir?: string;
}

export interface ReportResult {
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

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toString();
}

function groupBy<T, K extends string>(items: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of items) {
    const k = key(x);
    let arr = m.get(k);
    if (!arr) {
      arr = [];
      m.set(k, arr);
    }
    arr.push(x);
  }
  return m;
}

function renderWeek(weekStart: string, rows: WeeklyAggregation[], top: number): string {
  // Aggregate across the week
  const totals = rows.reduce(
    (acc, r) => {
      acc.sessions += r.sessions;
      acc.turns += r.turns;
      acc.compactions += r.compactions;
      acc.toolCalls += r.toolCalls;
      acc.totalUsage.newInputTokens += r.totalUsage.newInputTokens;
      acc.totalUsage.cachedInputTokens += r.totalUsage.cachedInputTokens;
      acc.totalUsage.cacheWriteTokens += r.totalUsage.cacheWriteTokens;
      acc.totalUsage.outputTokens += r.totalUsage.outputTokens;
      acc.totalUsage.reasoningTokens += r.totalUsage.reasoningTokens;
      acc.codexCredits += r.estimatedCost.codexCredits;
      acc.claudeUsdCents += r.estimatedCost.claudeUsdCents;
      if (r.rateLimitMax) {
        acc.peak5h = Math.max(acc.peak5h, r.rateLimitMax.primaryPercent);
        acc.peak7d = Math.max(acc.peak7d, r.rateLimitMax.secondaryPercent);
      }
      return acc;
    },
    {
      sessions: 0,
      turns: 0,
      compactions: 0,
      toolCalls: 0,
      totalUsage: {
        newInputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      codexCredits: 0,
      claudeUsdCents: 0,
      peak5h: 0,
      peak7d: 0,
    },
  );
  const cacheRatio = cacheEfficiency(totals.totalUsage);
  const totalIn = totalInputTokens(totals.totalUsage);

  const lines: string[] = [];
  lines.push(`## Week ${weekStart}`, '');
  lines.push('### Totals');
  lines.push('');
  lines.push(`- Sessions: ${totals.sessions}`);
  lines.push(`- Turns: ${totals.turns}`);
  lines.push(`- Tool calls: ${totals.toolCalls}`);
  lines.push(`- Compactions: ${totals.compactions}`);
  lines.push(
    `- Input tokens (total): ${fmt(totalIn)}  (cache hit ${(cacheRatio * 100).toFixed(1)}%)`,
  );
  lines.push(
    `- Output tokens: ${fmt(totals.totalUsage.outputTokens)}  (reasoning ${fmt(totals.totalUsage.reasoningTokens)})`,
  );
  const costParts: string[] = [];
  if (totals.codexCredits > 0) costParts.push(`${totals.codexCredits.toFixed(0)} Codex credits`);
  if (totals.claudeUsdCents > 0)
    costParts.push(`~$${(totals.claudeUsdCents / 100).toFixed(2)} Claude API-equiv`);
  lines.push(`- Estimated cost: ${costParts.length ? costParts.join(' + ') : '-'}`);
  if (totals.peak7d > 0 || totals.peak5h > 0) {
    lines.push(
      `- Codex quota peak observed: 5h window ${totals.peak5h.toFixed(0)}% · 7d window ${totals.peak7d.toFixed(0)}%`,
    );
  }
  lines.push(
    '- _Claude $ is notional (pay-as-you-go list price), not real spend on a flat-rate Max plan._',
  );
  lines.push('');

  // Top projects
  const byProject = groupBy(rows, (r) => r.projectCwd);
  const projectAgg = [...byProject.entries()]
    .map(([cwd, list]) => ({
      cwd,
      tokens: list.reduce(
        (s, r) => s + totalInputTokens(r.totalUsage) + r.totalUsage.outputTokens,
        0,
      ),
      sessions: list.reduce((s, r) => s + r.sessions, 0),
      turns: list.reduce((s, r) => s + r.turns, 0),
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, top);

  lines.push('### Top projects');
  lines.push('');
  lines.push('| project | sessions | turns | tokens |');
  lines.push('|---|---:|---:|---:|');
  for (const p of projectAgg) {
    lines.push(`| \`${p.cwd}\` | ${p.sessions} | ${p.turns} | ${fmt(p.tokens)} |`);
  }
  lines.push('');

  // Top models
  const byModel = groupBy(rows, (r) => `${r.tool}/${r.model}`);
  const modelAgg = [...byModel.entries()]
    .map(([key, list]) => ({
      key,
      tool: list[0]?.tool ?? 'codex',
      model: list[0]?.model ?? 'unknown',
      sessions: list.reduce((s, r) => s + r.sessions, 0),
      turns: list.reduce((s, r) => s + r.turns, 0),
      tokens: list.reduce(
        (s, r) => s + totalInputTokens(r.totalUsage) + r.totalUsage.outputTokens,
        0,
      ),
      codex: list.reduce((s, r) => s + r.estimatedCost.codexCredits, 0),
      claudeUsdCents: list.reduce((s, r) => s + r.estimatedCost.claudeUsdCents, 0),
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, top);

  lines.push('### Top models');
  lines.push('');
  lines.push('| tool | model | sessions | turns | tokens | cost |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const m of modelAgg) {
    const cost =
      m.codex > 0
        ? `${m.codex.toFixed(0)} cr`
        : m.claudeUsdCents > 0
          ? `$${(m.claudeUsdCents / 100).toFixed(2)}`
          : '-';
    lines.push(
      `| ${m.tool} | ${m.model} | ${m.sessions} | ${m.turns} | ${fmt(m.tokens)} | ${cost} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

export async function runReport(opts: ReportCommandOptions = {}): Promise<ReportResult> {
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
  const top = opts.top ?? 10;
  const rows = await aggregateWeekly(collect(collectOpts));
  const byWeek = groupBy(rows, (r) => r.weekStart);
  const weeks = [...byWeek.keys()].sort();
  const periodLine = weeks.length
    ? `Period: ${weeks[0]} → ${weeks[weeks.length - 1]} (${weeks.length} week${weeks.length === 1 ? '' : 's'})`
    : 'Period: no data';
  const head = ['# agent-stats — weekly report', '', periodLine];
  const body = weeks.map((w) => renderWeek(w, byWeek.get(w) ?? [], top));
  return {
    output:
      [...head, '', ...body]
        .filter((s) => s !== undefined)
        .join('\n')
        .trimEnd() + '\n',
    rows,
  };
  // Note: costString is currently referenced only for future use in renderWeek;
  // exposed indirectly to avoid dead-code elimination in some bundlers.
}
