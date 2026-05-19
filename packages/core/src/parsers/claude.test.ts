import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseClaudeSession } from './claude.js';
import type { SessionEvent } from '../schema.js';
import { totalInputTokens } from '../schema.js';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/claude/sample-session.jsonl',
);

async function collectAll(): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const ev of parseClaudeSession({ filePath: fixture })) {
    events.push(ev);
  }
  return events;
}

describe('parseClaudeSession', () => {
  it('emits a session_start and session_end', async () => {
    const events = await collectAll();
    expect(events[0]?.kind).toBe('session_start');
    expect(events.at(-1)?.kind).toBe('session_end');
  });

  it('captures the session id and project cwd from the records', async () => {
    const [start] = await collectAll();
    expect(start?.sessionId).toBe('test-session-001');
    expect(start?.projectCwd).toBe('/home/u/src/demo');
    expect(start?.tool).toBe('claude');
  });

  it('emits one turn event per assistant response with usage', async () => {
    const events = await collectAll();
    const turns = events.filter((e) => e.kind === 'turn');
    expect(turns).toHaveLength(3);
    const first = turns[0];
    expect(first?.kind).toBe('turn');
    if (first?.kind !== 'turn') throw new Error('unreachable');
    expect(first.model).toBe('claude-opus-4-7');
    expect(first.usage.newInputTokens).toBe(50);
    expect(first.usage.cacheWriteTokens).toBe(1200);
    expect(first.usage.cachedInputTokens).toBe(0);
    expect(first.usage.outputTokens).toBe(80);
    expect(totalInputTokens(first.usage)).toBe(1250);
  });

  it('emits a user_prompt with a hash for the user message', async () => {
    const events = await collectAll();
    const prompts = events.filter((e) => e.kind === 'user_prompt');
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    if (p?.kind !== 'user_prompt') throw new Error('unreachable');
    expect(p.textLength).toBeGreaterThan(0);
    expect(p.textHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits tool_call for both Bash and MCP tools', async () => {
    const events = await collectAll();
    const calls = events.filter((e) => e.kind === 'tool_call');
    expect(calls).toHaveLength(2);
    const bash = calls.find((c) => c.kind === 'tool_call' && c.name === 'Bash');
    const mcp = calls.find((c) => c.kind === 'tool_call' && c.name.startsWith('mcp__'));
    expect(bash).toBeDefined();
    expect(mcp).toBeDefined();
    if (bash?.kind === 'tool_call') expect(bash.category).toBe('bash');
    if (mcp?.kind === 'tool_call') expect(mcp.category).toBe('mcp');
  });

  it('counts cache reads correctly on subsequent assistant turns', async () => {
    const events = await collectAll();
    const turns = events.filter((e) => e.kind === 'turn');
    const second = turns[1];
    if (second?.kind !== 'turn') throw new Error('unreachable');
    expect(second.usage.cachedInputTokens).toBe(1280);
    expect(second.usage.cacheWriteTokens).toBe(0);
  });
});
