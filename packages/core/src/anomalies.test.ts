import { describe, expect, it } from 'vitest';

import { detectAnomalies } from './anomalies.js';
import type { SessionEvent } from './schema.js';

function ev(o: Partial<SessionEvent>): SessionEvent {
  return {
    tool: 'codex',
    sessionId: 's1',
    projectCwd: '/p/a',
    ts: '2026-05-18T10:00:00.000Z',
    kind: 'session_start',
    isSubagent: false,
    ...o,
  } as SessionEvent;
}

describe('detectAnomalies', () => {
  it('returns no anomalies for a calm session', async () => {
    const a = await detectAnomalies([
      ev({ kind: 'session_start', isSubagent: false }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
    ]);
    expect(a).toHaveLength(0);
  });

  it('flags runaway_compactions when ≥ threshold', async () => {
    const evs: SessionEvent[] = [ev({ kind: 'session_start', isSubagent: false })];
    for (let i = 0; i < 12; i++) {
      evs.push(ev({ kind: 'compaction', ts: `2026-05-18T10:0${i}:00.000Z` }));
    }
    const a = await detectAnomalies(evs);
    expect(a).toHaveLength(1);
    expect(a[0]?.type).toBe('runaway_compactions');
    expect(a[0]?.evidence.compactions).toBe(12);
  });

  it('flags high_error_rate when errors/total ≥ threshold (min 10 calls)', async () => {
    const evs: SessionEvent[] = [ev({ kind: 'session_start', isSubagent: false })];
    for (let i = 0; i < 12; i++) {
      evs.push(
        ev({
          kind: 'tool_call',
          ts: `2026-05-18T10:00:${i.toString().padStart(2, '0')}.000Z`,
          name: 'Bash',
          category: 'bash',
          error: i < 6, // 50% error rate
        }),
      );
    }
    const a = await detectAnomalies(evs);
    const e = a.find((x) => x.type === 'high_error_rate');
    expect(e).toBeDefined();
    expect(e?.evidence.errors).toBe(6);
    expect(e?.evidence.total).toBe(12);
  });

  it('flags prompt_retry_loop when the same hash repeats ≥ threshold', async () => {
    const evs: SessionEvent[] = [ev({ kind: 'session_start', isSubagent: false })];
    for (let i = 0; i < 5; i++) {
      evs.push(
        ev({
          kind: 'user_prompt',
          ts: `2026-05-18T10:0${i}:00.000Z`,
          textHash: 'h-repeated',
          textLength: 10,
        }),
      );
    }
    const a = await detectAnomalies(evs);
    expect(a.find((x) => x.type === 'prompt_retry_loop')?.evidence.count).toBe(5);
  });

  it('flags tool_loop when the same tool runs ≥ threshold consecutively', async () => {
    const evs: SessionEvent[] = [ev({ kind: 'session_start', isSubagent: false })];
    for (let i = 0; i < 6; i++) {
      evs.push(
        ev({
          kind: 'tool_call',
          ts: `2026-05-18T10:00:${i}.000Z`,
          name: 'Bash',
          category: 'bash',
        }),
      );
    }
    const a = await detectAnomalies(evs);
    const t = a.find((x) => x.type === 'tool_loop');
    expect(t?.evidence.tool).toBe('Bash');
    expect(t?.evidence.consecutive).toBe(6);
  });

  it('does NOT flag tool_loop when a user_prompt breaks the streak', async () => {
    const evs: SessionEvent[] = [
      ev({ kind: 'session_start', isSubagent: false }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
      ev({ kind: 'user_prompt', ts: 't', textHash: 'h', textLength: 4 }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
      ev({ kind: 'tool_call', ts: 't', name: 'Bash', category: 'bash' }),
    ];
    const a = await detectAnomalies(evs);
    expect(a.some((x) => x.type === 'tool_loop')).toBe(false);
  });

  it('flags zombie_session when consecutive turns are far apart', async () => {
    const evs: SessionEvent[] = [
      ev({ kind: 'session_start', isSubagent: false }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T10:00:00.000Z',
        model: 'gpt-5.5',
        usage: {
          newInputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      }),
      ev({
        kind: 'turn',
        ts: '2026-05-18T15:00:00.000Z', // 5h gap
        model: 'gpt-5.5',
        usage: {
          newInputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      }),
    ];
    const a = await detectAnomalies(evs);
    const z = a.find((x) => x.type === 'zombie_session');
    expect(z).toBeDefined();
    expect(Number(z?.evidence.maxGapMinutes)).toBeGreaterThanOrEqual(300);
  });

  it('respects custom thresholds', async () => {
    const evs: SessionEvent[] = [ev({ kind: 'session_start', isSubagent: false })];
    for (let i = 0; i < 5; i++) evs.push(ev({ kind: 'compaction', ts: 't' }));
    const noFlag = await detectAnomalies(evs, { runawayCompactions: 100 });
    expect(noFlag).toHaveLength(0);
    const flag = await detectAnomalies(evs, { runawayCompactions: 3 });
    expect(flag[0]?.type).toBe('runaway_compactions');
  });
});
