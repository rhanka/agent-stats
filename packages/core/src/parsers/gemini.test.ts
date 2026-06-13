import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  collectGeminiEvents,
  indexGeminiSessions,
  parseGeminiChat,
  parseGeminiLog,
} from './gemini.js';
import type { SessionEvent } from '../schema.js';

const fixturesTmpDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/gemini/tmp',
);
const chatFixture = path.join(fixturesTmpDir, 'demo/chats/session-2026-06-10T10-05-ba5e5639.jsonl');
const logFixture = path.join(fixturesTmpDir, 'log-only/logs.json');

async function gather(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const ev of iter) events.push(ev);
  return events;
}

describe('parseGeminiChat', () => {
  it('normalizes Gemini chat JSONL into redacted session events', async () => {
    const events = await gather(
      parseGeminiChat({ filePath: chatFixture, projectCwd: '/home/u/src/demo' }),
    );

    expect(events.map((e) => e.kind)).toEqual([
      'session_start',
      'user_prompt',
      'turn',
      'tool_call',
      'session_end',
    ]);
    expect(events[0]).toMatchObject({
      kind: 'session_start',
      tool: 'gemini',
      sessionId: 'ba5e5639-448c-4fb2-a4c3-7f2ddf0f0001',
      projectCwd: '/home/u/src/demo',
      isSubagent: false,
    });

    const prompt = events.find((e) => e.kind === 'user_prompt');
    if (prompt?.kind !== 'user_prompt') throw new Error('missing prompt');
    expect(prompt.textLength).toBe('Please inspect the demo project and run tests.'.length);
    expect(prompt.textHash).toMatch(/^[0-9a-f]{16}$/);

    const turn = events.find((e) => e.kind === 'turn');
    if (turn?.kind !== 'turn') throw new Error('missing turn');
    expect(turn.model).toBe('gemini-2.5-pro');
    expect(turn.usage).toEqual({
      newInputTokens: 1000,
      cachedInputTokens: 200,
      cacheWriteTokens: 0,
      outputTokens: 90,
      reasoningTokens: 30,
    });

    const tool = events.find((e) => e.kind === 'tool_call');
    expect(tool).toMatchObject({ kind: 'tool_call', name: 'run_shell_command', category: 'bash' });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Please inspect the demo project');
    expect(serialized).not.toContain('I will inspect the project');
    expect(serialized).not.toContain('test output should not leak');
  });
});

describe('indexGeminiSessions', () => {
  it('discovers chat sessions under ~/.gemini/tmp-style project dirs', async () => {
    const entries = await indexGeminiSessions({ tmpDir: fixturesTmpDir });
    expect(entries.map((e) => e.sessionId)).toContain('ba5e5639-448c-4fb2-a4c3-7f2ddf0f0001');
    expect(entries.find((e) => e.sessionId.startsWith('ba5e'))?.projectCwd).toBe(
      '/home/u/src/demo',
    );
  });
});

describe('parseGeminiLog', () => {
  it('falls back to redacted user prompts from logs.json', async () => {
    const events = await gather(
      parseGeminiLog({ filePath: logFixture, projectCwd: '/home/u/src/log-only' }),
    );
    expect(events.map((e) => e.kind)).toEqual(['session_start', 'user_prompt', 'session_end']);
    const prompt = events.find((e) => e.kind === 'user_prompt');
    if (prompt?.kind !== 'user_prompt') throw new Error('missing prompt');
    expect(prompt.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(events)).not.toContain('Log fallback prompt');
  });
});

describe('collectGeminiEvents', () => {
  it('streams Gemini events and applies project filters', async () => {
    const events = await gather(
      collectGeminiEvents({ tmpDir: fixturesTmpDir, projectCwd: '/home/u/src/demo' }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.tool === 'gemini')).toBe(true);
    expect(events.every((e) => e.projectCwd === '/home/u/src/demo')).toBe(true);
  });
});
