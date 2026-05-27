import { describe, expect, it } from 'vitest';

import {
  aggregateSessions,
  aggregateWeekly,
  bucketWeekly,
  bucketBy,
  cacheEfficiency,
  weekStartIso,
  dayStartIso,
} from './aggregations.js';
import type { SessionEvent } from './schema.js';

const baseTs = '2026-05-18T10:00:00.000Z'; // Monday

function ev(extra: Partial<SessionEvent>): SessionEvent {
  return {
    tool: 'codex',
    sessionId: 'sess-1',
    projectCwd: '/p/a',
    ts: baseTs,
    kind: 'session_start',
    isSubagent: false,
    ...extra,
  } as SessionEvent;
}

describe('weekStartIso', () => {
  it('returns Monday for any day of the same ISO week', () => {
    // Monday 2026-05-18 → 2026-05-18
    expect(weekStartIso('2026-05-18T10:00:00Z')).toBe('2026-05-18');
    // Wednesday 2026-05-20 → 2026-05-18
    expect(weekStartIso('2026-05-20T10:00:00Z')).toBe('2026-05-18');
    // Sunday 2026-05-24 → 2026-05-18 (still in that week)
    expect(weekStartIso('2026-05-24T23:59:00Z')).toBe('2026-05-18');
    // Monday 2026-05-25 → next week
    expect(weekStartIso('2026-05-25T00:00:00Z')).toBe('2026-05-25');
  });
});

describe('aggregateSessions', () => {
  it('rolls usage and counts per session', async () => {
    const events: SessionEvent[] = [
      ev({ kind: 'session_start', model: 'gpt-5.5', isSubagent: false }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:01Z',
        model: 'gpt-5.5',
        usage: {
          newInputTokens: 1000,
          cachedInputTokens: 9000,
          cacheWriteTokens: 0,
          outputTokens: 200,
          reasoningTokens: 50,
        },
      }),
      ev({
        kind: 'tool_call',
        ts: '2026-05-18T10:00:02Z',
        name: 'Bash',
        category: 'bash',
      }),
      ev({
        kind: 'tool_call',
        ts: '2026-05-18T10:00:03Z',
        name: 'Bash',
        category: 'bash',
      }),
      ev({
        kind: 'tool_call',
        ts: '2026-05-18T10:00:04Z',
        name: 'mcp__playwright__browser_snapshot',
        category: 'mcp',
      }),
      ev({ kind: 'compaction', ts: '2026-05-18T10:00:05Z' }),
      ev({ kind: 'session_end', ts: '2026-05-18T10:30:00Z' }),
    ];

    const [s] = await aggregateSessions(events);
    expect(s).toBeDefined();
    if (!s) throw new Error('unreachable');
    expect(s.sessionId).toBe('sess-1');
    expect(s.tool).toBe('codex');
    expect(s.model).toBe('gpt-5.5');
    expect(s.turns).toBe(1);
    expect(s.totalUsage.newInputTokens).toBe(1000);
    expect(s.totalUsage.cachedInputTokens).toBe(9000);
    expect(s.toolCalls).toBe(3);
    expect(s.toolCallsByCategory['bash']).toBe(2);
    expect(s.toolCallsByCategory['mcp']).toBe(1);
    expect(s.toolCallsByName['Bash']).toBe(2);
    expect(s.compactions).toBe(1);
    expect(s.durationMs).toBe(30 * 60 * 1000);
    expect(s.isSubagent).toBe(false);
  });

  it('estimates cost in the correct currency bucket per model', async () => {
    const events: SessionEvent[] = [
      ev({ kind: 'session_start', model: 'gpt-5.5', isSubagent: false }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:01Z',
        model: 'gpt-5.5',
        usage: {
          newInputTokens: 1_000_000,
          cachedInputTokens: 1_000_000,
          cacheWriteTokens: 0,
          outputTokens: 1_000_000,
          reasoningTokens: 0,
        },
      }),
      // second session, Claude model
      {
        kind: 'session_start',
        tool: 'claude',
        sessionId: 'sess-claude',
        projectCwd: '/p/b',
        ts: '2026-05-18T11:00:00Z',
        model: 'claude-opus-4-7',
        isSubagent: false,
      },
      {
        kind: 'turn',
        tool: 'claude',
        sessionId: 'sess-claude',
        projectCwd: '/p/b',
        ts: '2026-05-18T11:00:01Z',
        model: 'claude-opus-4-7',
        usage: {
          newInputTokens: 1_000_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1_000_000,
          reasoningTokens: 0,
        },
      },
    ];

    const sessions = await aggregateSessions(events);
    const codex = sessions.find((s) => s.tool === 'codex');
    const claude = sessions.find((s) => s.tool === 'claude');
    expect(codex?.estimatedCost.codexCredits).toBe(125 + 12.5 + 750); // 887.5
    expect(codex?.estimatedCost.claudeUsdCents).toBe(0);
    expect(claude?.estimatedCost.claudeUsdCents).toBe(1500 + 7500); // 9000
    expect(claude?.estimatedCost.codexCredits).toBe(0);
  });

  it('tracks max rate_limit and subagent flag', async () => {
    const events: SessionEvent[] = [
      ev({
        kind: 'session_start',
        model: 'gpt-5.5',
        isSubagent: true,
        forkedFromId: 'parent-1',
      }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:01Z',
        model: 'gpt-5.5',
        usage: { ...zeroUsage(), outputTokens: 10 },
        rateLimit: { primaryPercent: 50, secondaryPercent: 30 },
      }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:02Z',
        model: 'gpt-5.5',
        usage: { ...zeroUsage(), outputTokens: 10 },
        rateLimit: { primaryPercent: 80, secondaryPercent: 35 },
      }),
    ];
    const [s] = await aggregateSessions(events);
    if (!s) throw new Error('unreachable');
    expect(s.isSubagent).toBe(true);
    expect(s.forkedFromId).toBe('parent-1');
    expect(s.rateLimitMax?.primaryPercent).toBe(80);
    expect(s.rateLimitMax?.secondaryPercent).toBe(35);
  });
});

describe('bucketWeekly', () => {
  it('groups by (week, project, tool, model) and counts unique parents', () => {
    const sessions = [
      {
        sessionId: 's1',
        tool: 'codex' as const,
        projectCwd: '/p/a',
        model: 'gpt-5.5',
        startTs: '2026-05-18T10:00:00Z',
        endTs: '2026-05-18T10:10:00Z',
        durationMs: 600_000,
        turns: 1,
        totalUsage: { ...zeroUsage() },
        isSubagent: true,
        forkedFromId: 'parent-A',
        toolCalls: 0,
        toolCallsByCategory: {},
        toolCallsByName: {},
        skillInvocations: 0,
        skillsByName: {},
        compactions: 0,
        estimatedCost: { codexCredits: 100, claudeUsdCents: 0, unknown: 0 },
      },
      {
        sessionId: 's2',
        tool: 'codex' as const,
        projectCwd: '/p/a',
        model: 'gpt-5.5',
        startTs: '2026-05-19T10:00:00Z',
        endTs: '2026-05-19T10:10:00Z',
        durationMs: 600_000,
        turns: 1,
        totalUsage: { ...zeroUsage() },
        isSubagent: true,
        forkedFromId: 'parent-A', // SAME parent → uniqueParents stays at 1
        toolCalls: 0,
        toolCallsByCategory: {},
        toolCallsByName: {},
        skillInvocations: 0,
        skillsByName: {},
        compactions: 0,
        estimatedCost: { codexCredits: 200, claudeUsdCents: 0, unknown: 0 },
      },
      {
        sessionId: 's3',
        tool: 'codex' as const,
        projectCwd: '/p/a',
        model: 'gpt-5.4',
        startTs: '2026-05-18T11:00:00Z',
        endTs: '2026-05-18T11:10:00Z',
        durationMs: 600_000,
        turns: 1,
        totalUsage: { ...zeroUsage() },
        isSubagent: false,
        toolCalls: 0,
        toolCallsByCategory: {},
        toolCallsByName: {},
        skillInvocations: 0,
        skillsByName: {},
        compactions: 0,
        estimatedCost: { codexCredits: 50, claudeUsdCents: 0, unknown: 0 },
      },
    ];
    const buckets = bucketWeekly(sessions);
    // 2 sessions on (week=2026-05-18, /p/a, codex, gpt-5.5) → 1 row
    // 1 session  on (week=2026-05-18, /p/a, codex, gpt-5.4)  → 1 row
    expect(buckets).toHaveLength(2);
    const gpt55 = buckets.find((b) => b.model === 'gpt-5.5');
    const gpt54 = buckets.find((b) => b.model === 'gpt-5.4');
    expect(gpt55?.sessions).toBe(2);
    expect(gpt55?.subagentSessions).toBe(2);
    expect(gpt55?.uniqueParents).toBe(1);
    expect(gpt55?.estimatedCost.codexCredits).toBe(300);
    expect(gpt54?.sessions).toBe(1);
    expect(gpt54?.subagentSessions).toBe(0);
    expect(gpt54?.uniqueParents).toBe(0);
  });
});

describe('dayStartIso + bucketBy("day")', () => {
  const mk = (id: string, startTs: string) => ({
    sessionId: id,
    tool: 'codex' as const,
    projectCwd: '/p/a',
    model: 'gpt-5.5',
    startTs,
    endTs: startTs,
    durationMs: 0,
    turns: 1,
    totalUsage: { ...zeroUsage() },
    isSubagent: false,
    toolCalls: 0,
    toolCallsByCategory: {},
    toolCallsByName: {},
    skillInvocations: 0,
    skillsByName: {},
    compactions: 0,
    estimatedCost: { codexCredits: 0, claudeUsdCents: 0, unknown: 0 },
  });

  it('dayStartIso returns the calendar day', () => {
    expect(dayStartIso('2026-05-20T23:59:00Z')).toBe('2026-05-20');
  });

  it('buckets per calendar day (same week → separate daily rows) and tags granularity', () => {
    // Same week as the weekly test, but two different days → 2 daily rows.
    const rows = bucketBy(
      [mk('s1', '2026-05-18T10:00:00Z'), mk('s2', '2026-05-19T10:00:00Z')],
      'day',
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-05-18', '2026-05-19']);
    expect(rows.every((r) => r.granularity === 'day')).toBe(true);
    // Weekly bucketing of the same sessions collapses them into one row.
    expect(
      bucketWeekly([mk('s1', '2026-05-18T10:00:00Z'), mk('s2', '2026-05-19T10:00:00Z')]),
    ).toHaveLength(1);
  });
});

describe('aggregateWeekly (end-to-end)', () => {
  it('produces a single row for one session/week/model', async () => {
    const events: SessionEvent[] = [
      ev({ kind: 'session_start', model: 'gpt-5.5', isSubagent: false }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:01Z',
        model: 'gpt-5.5',
        usage: {
          newInputTokens: 1_000_000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      }),
      ev({ kind: 'session_end', ts: '2026-05-18T10:10:00Z' }),
    ];
    const rows = await aggregateWeekly(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weekStart).toBe('2026-05-18');
    expect(rows[0]?.estimatedCost.codexCredits).toBe(125);
  });
});

describe('cacheEfficiency', () => {
  it('returns cached / total input ratio', () => {
    expect(
      cacheEfficiency({
        newInputTokens: 100,
        cachedInputTokens: 900,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(0.9);
    expect(
      cacheEfficiency({
        newInputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(0);
  });
});

function zeroUsage(): SessionEvent extends { usage: infer U } ? U : never {
  return {
    newInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  } as SessionEvent extends { usage: infer U } ? U : never;
}
