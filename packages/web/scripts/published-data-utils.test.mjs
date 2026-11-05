import { describe, expect, test } from 'vitest';

import {
  buildPrivateMap,
  incrementalDaysSinceMeta,
  mergeAnomaliesByKey,
  mergeIncrementalRows,
  periodStartForIncremental,
  publicRepoFromRemote,
  scrubInvalidRepoRows,
} from './published-data-utils.mjs';

const usage = {
  newInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

function row(weekStart, projectCwd, sessions = 1) {
  return {
    weekStart,
    projectCwd,
    tool: 'codex',
    model: 'gpt-5.3-codex',
    granularity: 'week',
    sessions,
    subagentSessions: 0,
    uniqueParents: 0,
    totalDurationMs: 0,
    turns: 0,
    totalUsage: { ...usage },
    toolCalls: 0,
    toolCallsByCategory: {},
    toolCallsByName: {},
    skillInvocations: 0,
    skillsByName: {},
    compactions: 0,
    sessionsBySurface: {},
    estimatedCost: { codexCredits: 0, claudeUsdCents: 0, unknown: 0 },
  };
}

describe('published data incremental helpers', () => {
  test('mergeIncrementalRows replaces only rows in the recalculated period window', () => {
    const existing = [
      row('2026-05-11', 'rhanka/agent-stats', 1),
      row('2026-05-18', 'rhanka/agent-stats', 2),
      row('2026-05-25', 'rhanka/agent-stats', 3),
    ];
    const refreshed = [
      row('2026-05-18', 'rhanka/agent-stats', 20),
      row('2026-06-01', 'rhanka/agent-stats', 4),
    ];

    const merged = mergeIncrementalRows(existing, refreshed, '2026-05-18');

    expect(merged.map((r) => [r.weekStart, r.sessions])).toEqual([
      ['2026-05-11', 1],
      ['2026-05-18', 20],
      // Absent from the refreshed data (transcripts purged): published rows kept.
      ['2026-05-25', 3],
      ['2026-06-01', 4],
    ]);
  });

  test('mergeIncrementalRows keeps published rows when transcripts were purged', () => {
    const claude = (weekStart, projectCwd, sessions) => ({
      ...row(weekStart, projectCwd, sessions),
      tool: 'claude',
    });
    const existing = [
      claude('2026-07-13', 'rhanka/agent-stats', 1500),
      claude('2026-07-13', 'rhanka/h2a', 622),
      row('2026-07-13', 'rhanka/agent-stats', 2106),
    ];
    const refreshed = [
      claude('2026-07-13', 'rhanka/agent-stats', 3), // Claude Code purged the rest
      row('2026-07-13', 'rhanka/agent-stats', 2125), // Codex still complete
    ];
    const retained = [];

    const merged = mergeIncrementalRows(existing, refreshed, '2026-07-13', retained);

    expect(merged.map((r) => [r.tool, r.projectCwd, r.sessions])).toEqual([
      ['claude', 'rhanka/agent-stats', 1500],
      ['codex', 'rhanka/agent-stats', 2125],
      ['claude', 'rhanka/h2a', 622],
    ]);
    expect(retained).toEqual(['2026-07-13|claude']);
  });

  test('periodStartForIncremental snaps the rebuild window to a UTC Monday', () => {
    expect(periodStartForIncremental(new Date('2026-06-06T12:00:00Z'), 14)).toBe('2026-05-18');
  });

  test('incrementalDaysSinceMeta covers the gap since the last publication plus a margin', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    // Publisher down since 22 July: 105 days elapsed + 7 days margin.
    expect(incrementalDaysSinceMeta({ generatedAt: '2026-07-22T21:04:21.950Z' }, now)).toBe(112);
    // Daily run: never below the minimum window.
    expect(incrementalDaysSinceMeta({ generatedAt: '2026-11-04T07:30:00Z' }, now, 7, 10)).toBe(10);
    expect(incrementalDaysSinceMeta({ generatedAt: '2026-11-04T07:30:00Z' }, now)).toBe(8);
    expect(incrementalDaysSinceMeta({}, now)).toBeNull();
    expect(incrementalDaysSinceMeta(null, now)).toBeNull();
  });

  test('mergeAnomaliesByKey updates refreshed anomalies without duplicating old keys', () => {
    const existing = [
      { sessionId: 'a', tool: 'codex', projectCwd: 'old', type: 'tool_loop', severity: 'low' },
      {
        sessionId: 'b',
        tool: 'claude',
        projectCwd: 'old',
        type: 'zombie_session',
        severity: 'low',
      },
    ];
    const refreshed = [
      { sessionId: 'a', tool: 'codex', projectCwd: 'new', type: 'tool_loop', severity: 'high' },
    ];

    expect(mergeAnomaliesByKey(existing, refreshed)).toEqual([
      { sessionId: 'a', tool: 'codex', projectCwd: 'new', type: 'tool_loop', severity: 'high' },
      {
        sessionId: 'b',
        tool: 'claude',
        projectCwd: 'old',
        type: 'zombie_session',
        severity: 'low',
      },
    ]);
  });

  test('buildPrivateMap keeps existing private labels and assigns new private labels after them', () => {
    const map = buildPrivateMap([
      row('2026-05-11', 'private-1', 100),
      row('2026-05-18', 'local-worktree', 50),
      {
        ...row('2026-05-18', 'rhanka/agent-stats', 25),
        repoUrl: 'https://github.com/rhanka/agent-stats',
      },
    ]);

    expect([...map.entries()]).toEqual([['local-worktree', 'private-2']]);
  });

  test('publicRepoFromRemote ignores local filesystem remotes', () => {
    expect(
      publicRepoFromRemote('/home/antoinefa/src/public-domaine-mystery-sagas-pack'),
    ).toBeNull();
    expect(
      publicRepoFromRemote('https://github.com/src/public-domaine-mystery-sagas-pack'),
    ).toBeNull();
  });

  test('publicRepoFromRemote accepts GitHub and GitLab SSH/HTTPS remotes', () => {
    expect(publicRepoFromRemote('git@github.com:rhanka/agent-stats.git')).toEqual({
      label: 'rhanka/agent-stats',
      url: 'https://github.com/rhanka/agent-stats',
    });
    expect(publicRepoFromRemote('https://gitlab.com/acme/demo.git')).toEqual({
      label: 'acme/demo',
      url: 'https://gitlab.com/acme/demo',
    });
  });

  test('scrubInvalidRepoRows removes stale fake repo URLs before anonymization', () => {
    const rows = [
      {
        projectCwd: 'src/public-domaine-mystery-sagas-pack',
        repoUrl: 'https://github.com/src/public-domaine-mystery-sagas-pack',
      },
      {
        projectCwd: 'rhanka/agent-stats',
        repoUrl: 'https://github.com/rhanka/agent-stats',
      },
    ];

    expect(scrubInvalidRepoRows(rows)).toEqual([
      { projectCwd: 'src/public-domaine-mystery-sagas-pack' },
      { projectCwd: 'rhanka/agent-stats', repoUrl: 'https://github.com/rhanka/agent-stats' },
    ]);
  });
});
