/**
 * Pure helpers to turn weekly aggregation rows into single-series chart data
 * (e.g. for the design-system LineChart / Sparkline which take {x,y}[] /
 * number[]). Lives in core (no UI dependency) so it is unit-tested without the
 * SvelteKit toolchain.
 */

export type SeriesMetric = 'tokens' | 'credits' | 'quota7d' | 'sessions';
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
  };
  estimatedCost: { codexCredits: number };
  rateLimitMax?: { secondaryPercent: number };
}

export interface SeriesPoint {
  x: string;
  y: number;
}

function metricValue(r: SeriesRow, metric: SeriesMetric): number {
  switch (metric) {
    case 'tokens':
      return (
        r.totalUsage.newInputTokens +
        r.totalUsage.cachedInputTokens +
        r.totalUsage.cacheWriteTokens +
        r.totalUsage.outputTokens
      );
    case 'credits':
      return r.estimatedCost.codexCredits;
    case 'sessions':
      return r.sessions;
    case 'quota7d':
      return r.rateLimitMax?.secondaryPercent ?? 0;
  }
}

/**
 * Bucket rows by `weekStart` for one metric and tool filter.
 * Most metrics sum within a week; `quota7d` is a rate-limit peak so it takes
 * the max. Returned points are sorted ascending by week.
 */
export function weeklySeries(
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
