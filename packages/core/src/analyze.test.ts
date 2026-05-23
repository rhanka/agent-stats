import { describe, expect, it, vi } from 'vitest';

import { analyzeWithLlm, benchModels, type LlmMeshLike } from './analyze.js';
import type { SessionAggregate } from './aggregations.js';

function makeSession(over: Partial<SessionAggregate> = {}): SessionAggregate {
  return {
    sessionId: 's1',
    tool: 'codex',
    projectCwd: '/p/a',
    model: 'gpt-5.5',
    startTs: '2026-05-18T10:00:00Z',
    endTs: '2026-05-18T11:00:00Z',
    durationMs: 3_600_000,
    turns: 50,
    totalUsage: {
      newInputTokens: 100,
      cachedInputTokens: 9000,
      cacheWriteTokens: 0,
      outputTokens: 1000,
      reasoningTokens: 200,
    },
    isSubagent: false,
    toolCalls: 30,
    toolCallsByCategory: { bash: 15, mcp: 5, native: 10 },
    toolCallsByName: { Bash: 15 },
    skillInvocations: 0,
    skillsByName: {},
    compactions: 4,
    estimatedCost: { codexCredits: 250, claudeUsdCents: 0, unknown: 0 },
    ...over,
  };
}

function mockMesh(response: object): LlmMeshLike {
  return {
    generate: vi.fn(async () => ({
      message: { content: JSON.stringify(response) },
    })),
  };
}

describe('analyzeWithLlm', () => {
  it('produces a clamped, well-typed verdict from a mesh response', async () => {
    const mesh = mockMesh({
      frustrationLevel: 6,
      outOfControlScore: 3,
      summary: 'Many bash retries.',
      rootCauses: ['flaky network', 'sandbox denies write'],
    });
    const v = await analyzeWithLlm(makeSession(), { mesh, model: 'mistral-small-4' });
    expect(v.frustrationLevel).toBe(6);
    expect(v.outOfControlScore).toBe(3);
    expect(v.summary).toMatch(/bash retries/);
    expect(v.rootCauses).toHaveLength(2);
    expect(v.sessionId).toBe('s1');
    expect(v.model).toBe('mistral-small-4');
  });

  it('clamps scores outside [0..10]', async () => {
    const mesh = mockMesh({
      frustrationLevel: 42,
      outOfControlScore: -3,
      summary: 'bad',
      rootCauses: [],
    });
    const v = await analyzeWithLlm(makeSession(), { mesh, model: 'm' });
    expect(v.frustrationLevel).toBe(10);
    expect(v.outOfControlScore).toBe(0);
  });

  it('handles markdown-fenced JSON in the response', async () => {
    const fenced: LlmMeshLike = {
      generate: vi.fn(async () => ({
        message: {
          content:
            '```json\n{"frustrationLevel":2,"outOfControlScore":1,"summary":"calm","rootCauses":[]}\n```',
        },
      })),
    };
    const v = await analyzeWithLlm(makeSession(), { mesh: fenced, model: 'm' });
    expect(v.frustrationLevel).toBe(2);
    expect(v.summary).toBe('calm');
  });

  it('uses cache when available and skips the mesh on hit', async () => {
    const verdict = {
      sessionId: 's1',
      model: 'm',
      frustrationLevel: 7,
      outOfControlScore: 5,
      summary: 'cached',
      rootCauses: [],
    };
    const cache = {
      read: vi.fn(async () => verdict),
      write: vi.fn(async () => undefined),
    };
    const mesh = mockMesh({
      frustrationLevel: 0,
      outOfControlScore: 0,
      summary: '',
      rootCauses: [],
    });
    const v = await analyzeWithLlm(makeSession(), { mesh, model: 'm', cache });
    expect(v).toEqual(verdict);
    expect(mesh.generate).not.toHaveBeenCalled();
    expect(cache.read).toHaveBeenCalledTimes(1);
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('writes to cache after a fresh mesh call', async () => {
    const cache = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    const mesh = mockMesh({
      frustrationLevel: 4,
      outOfControlScore: 2,
      summary: 'ok',
      rootCauses: [],
    });
    await analyzeWithLlm(makeSession(), { mesh, model: 'm', cache });
    expect(cache.write).toHaveBeenCalledTimes(1);
  });

  it('throws on empty mesh response', async () => {
    const mesh: LlmMeshLike = { generate: vi.fn(async () => ({ message: { content: '' } })) };
    await expect(analyzeWithLlm(makeSession(), { mesh, model: 'm' })).rejects.toThrow(
      /empty response/,
    );
  });
});

describe('benchModels', () => {
  it('compares two models against a baseline with MAE scoring', async () => {
    const sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })];
    const baselines = [
      { sessionId: 'a', frustrationLevel: 5, outOfControlScore: 5 },
      { sessionId: 'b', frustrationLevel: 5, outOfControlScore: 5 },
    ];
    const accurate = mockMesh({
      frustrationLevel: 5,
      outOfControlScore: 5,
      summary: '',
      rootCauses: [],
    });
    const wrong = mockMesh({
      frustrationLevel: 9,
      outOfControlScore: 1,
      summary: '',
      rootCauses: [],
    });
    const results = await benchModels({
      sessions,
      baselines,
      models: [
        { model: 'good', mesh: accurate },
        { model: 'bad', mesh: wrong },
      ],
    });
    expect(results).toHaveLength(2);
    const good = results.find((r) => r.model === 'good');
    const bad = results.find((r) => r.model === 'bad');
    expect(good?.meanAbsoluteError).toBe(0);
    expect(bad?.meanAbsoluteError).toBe(4); // ((|9-5|+|1-5|)/2) average
    expect(good?.samples).toBe(2);
  });
});
