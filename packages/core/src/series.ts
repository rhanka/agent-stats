/**
 * Pure helpers to turn weekly aggregation rows into single-series chart data
 * (e.g. for the design-system LineChart / Sparkline which take {x,y}[] /
 * number[]). Lives in core (no UI dependency) so it is unit-tested without the
 * SvelteKit toolchain.
 */

export type SeriesMetric =
  // headline / sparkline metrics
  | 'tokens'
  | 'credits'
  | 'quota7d'
  | 'sessions'
  // token-component metrics (chart selector; cached is isolated, excluded from in/out)
  | 'inputNew'
  | 'output'
  | 'inout'
  | 'cached';
export type ToolFilter = 'all' | 'claude' | 'codex' | 'cursor';

/** The subset of a WeeklyAggregation row the charts need (structural). */
export interface SeriesRow {
  weekStart: string;
  tool: 'claude' | 'codex' | 'cursor';
  sessions: number;
  totalUsage: {
    newInputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
  };
  estimatedCost: { codexCredits: number };
  rateLimitMax?: { secondaryPercent: number };
}

export interface SeriesPoint {
  x: string;
  y: number;
}

function metricValue(r: SeriesRow, metric: SeriesMetric): number {
  const u = r.totalUsage;
  const inputNew = u.newInputTokens + u.cacheWriteTokens;
  const output = u.outputTokens + (u.reasoningTokens ?? 0);
  switch (metric) {
    case 'tokens': // legacy headline metric: all input + output (cache included)
      return u.newInputTokens + u.cachedInputTokens + u.cacheWriteTokens + u.outputTokens;
    case 'credits':
      return r.estimatedCost.codexCredits;
    case 'sessions':
      return r.sessions;
    case 'quota7d':
      return r.rateLimitMax?.secondaryPercent ?? 0;
    case 'inputNew':
      return inputNew;
    case 'output':
      return output;
    case 'inout': // cached read excluded
      return inputNew + output;
    case 'cached':
      return u.cachedInputTokens;
  }
}

/**
 * Bucket rows by their bucket start (`weekStart`, which holds the day for daily
 * rows) for one metric and tool filter. Most metrics sum within a bucket;
 * `quota7d` is a rate-limit peak so it takes the max. Sorted ascending.
 */
export function periodSeries(
  rows: SeriesRow[],
  metric: SeriesMetric,
  tool: ToolFilter,
): SeriesPoint[] {
  const filtered = tool === 'all' ? rows : rows.filter((r) => r.tool === tool);
  const isMax = metric === 'quota7d';
  const byWeek = new Map<string, number>();
  for (const r of filtered) {
    const v = metricValue(r, metric);
    const prev = byWeek.get(r.weekStart);
    if (prev === undefined) byWeek.set(r.weekStart, v);
    else byWeek.set(r.weekStart, isMax ? Math.max(prev, v) : prev + v);
  }
  return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([x, y]) => ({ x, y }));
}

/** @deprecated use {@link periodSeries} (granularity-agnostic). */
export const weeklySeries = periodSeries;
