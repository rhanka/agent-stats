import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { JsonStorage } from './storage.js';
import type { WeeklyAggregation } from './aggregations.js';

function row(over: Partial<WeeklyAggregation>): WeeklyAggregation {
  return {
    weekStart: '2026-05-18',
    projectCwd: '/p/a',
    tool: 'codex',
    model: 'gpt-5.5',
    sessions: 1,
    subagentSessions: 0,
    uniqueParents: 0,
    totalDurationMs: 0,
    turns: 0,
    totalUsage: {
      newInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
    toolCalls: 0,
    toolCallsByCategory: {},
    toolCallsByName: {},
    skillInvocations: 0,
    skillsByName: {},
    compactions: 0,
    estimatedCost: { codexCredits: 0, claudeUsdCents: 0, unknown: 0 },
    ...over,
  };
}

describe('JsonStorage', () => {
  let tmp: string;
  let store: JsonStorage;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'agent-stats-storage-'));
    store = new JsonStorage({ rootDir: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('saves and loads a single row', async () => {
    const r = row({ sessions: 7 });
    await store.save([r]);
    const got = await store.load();
    expect(got).toHaveLength(1);
    expect(got[0]?.sessions).toBe(7);
  });

  it('groups rows by (week, tool) on disk', async () => {
    await store.save([
      row({ weekStart: '2026-05-18', tool: 'codex', projectCwd: '/p/a' }),
      row({ weekStart: '2026-05-18', tool: 'claude', projectCwd: '/p/a' }),
      row({ weekStart: '2026-05-25', tool: 'codex', projectCwd: '/p/b' }),
    ]);
    const all = await store.load();
    expect(all).toHaveLength(3);
  });

  it('filters by weekStart', async () => {
    await store.save([
      row({ weekStart: '2026-05-18' }),
      row({ weekStart: '2026-05-25', projectCwd: '/p/b' }),
    ]);
    const got = await store.load({ weekStart: '2026-05-25' });
    expect(got).toHaveLength(1);
    expect(got[0]?.projectCwd).toBe('/p/b');
  });

  it('filters by tool', async () => {
    await store.save([row({ tool: 'codex' }), row({ tool: 'claude', projectCwd: '/p/b' })]);
    const got = await store.load({ tool: 'claude' });
    expect(got).toHaveLength(1);
    expect(got[0]?.tool).toBe('claude');
  });

  it('filters by projectCwd (exact) and prefix', async () => {
    await store.save([
      row({ projectCwd: '/p/a' }),
      row({ projectCwd: '/p/b', model: 'gpt-5.4' }),
      row({ projectCwd: '/q/x', model: 'gpt-5.4' }),
    ]);
    const exact = await store.load({ projectCwd: '/p/a' });
    expect(exact).toHaveLength(1);
    const prefix = await store.load({ projectCwd: '/p/' });
    expect(prefix).toHaveLength(2);
  });

  it('upserts on same (week, project, tool, model) key', async () => {
    await store.save([row({ sessions: 1 })]);
    await store.save([row({ sessions: 42 })]);
    const got = await store.load();
    expect(got).toHaveLength(1);
    expect(got[0]?.sessions).toBe(42);
  });
});
