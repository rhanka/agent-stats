import { describe, expect, it } from 'vitest';
import { weeklySeries, type SeriesRow } from './series.js';

const row = (
  over: Partial<SeriesRow> & { weekStart: string; tool: 'claude' | 'codex' },
): SeriesRow => ({
  sessions: 1,
  totalUsage: { newInputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  estimatedCost: { codexCredits: 0 },
  ...over,
});

const rows: SeriesRow[] = [
  row({
    weekStart: '2026-05-04',
    tool: 'codex',
    sessions: 2,
    totalUsage: {
      newInputTokens: 100,
      cachedInputTokens: 900,
      cacheWriteTokens: 0,
      outputTokens: 50,
    },
    estimatedCost: { codexCredits: 30 },
    rateLimitMax: { secondaryPercent: 40 },
  }),
  row({
    weekStart: '2026-05-04',
    tool: 'claude',
    sessions: 3,
    totalUsage: {
      newInputTokens: 10,
      cachedInputTokens: 90,
      cacheWriteTokens: 5,
      outputTokens: 20,
    },
    estimatedCost: { codexCredits: 0 },
    rateLimitMax: { secondaryPercent: 80 },
  }),
  row({
    weekStart: '2026-04-27',
    tool: 'codex',
    sessions: 1,
    totalUsage: { newInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    estimatedCost: { codexCredits: 5 },
    rateLimitMax: { secondaryPercent: 10 },
  }),
];

describe('weeklySeries', () => {
  it('sums tokens per week and returns ascending weeks', () => {
    const s = weeklySeries(rows, 'tokens', 'all');
    expect(s.map((p) => p.x)).toEqual(['2026-04-27', '2026-05-04']);
    expect(s[1]?.y).toBe(100 + 900 + 50 + (10 + 90 + 5 + 20)); // both tools that week
  });

  it('sums credits', () => {
    const s = weeklySeries(rows, 'credits', 'all');
    expect(s.find((p) => p.x === '2026-05-04')?.y).toBe(30);
  });

  it('takes the MAX (not sum) for quota7d', () => {
    const s = weeklySeries(rows, 'quota7d', 'all');
    expect(s.find((p) => p.x === '2026-05-04')?.y).toBe(80); // max(40, 80)
  });

  it('filters by tool before bucketing', () => {
    const codex = weeklySeries(rows, 'sessions', 'codex');
    expect(codex.find((p) => p.x === '2026-05-04')?.y).toBe(2);
    const claude = weeklySeries(rows, 'sessions', 'claude');
    expect(claude.find((p) => p.x === '2026-05-04')?.y).toBe(3);
    expect(claude.find((p) => p.x === '2026-04-27')).toBeUndefined();
  });

  it('defaults quota to 0 when rateLimitMax is absent', () => {
    const s = weeklySeries([row({ weekStart: '2026-01-05', tool: 'claude' })], 'quota7d', 'all');
    expect(s[0]?.y).toBe(0);
  });
});
