import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { indexCodexSessions, parseCodexRollout } from './codex.js';
import type { SessionEvent } from '../schema.js';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/codex/sample-rollout.jsonl',
);

async function collectAll(): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const ev of parseCodexRollout({ filePath: fixture })) {
    events.push(ev);
  }
  return events;
}

describe('parseCodexRollout', () => {
  it('emits session_start from session_meta and session_end at the tail', async () => {
    const events = await collectAll();
    expect(events[0]?.kind).toBe('session_start');
    expect(events.at(-1)?.kind).toBe('session_end');
    if (events[0]?.kind !== 'session_start') throw new Error('unreachable');
    expect(events[0].sessionId).toBe('019e0000-1111-2222-3333-444444444444');
    expect(events[0].projectCwd).toBe('/home/u/src/demo');
    expect(events[0].cliVersion).toBe('0.130.0');
    expect(events[0].isSubagent).toBe(false);
    expect(events[0].surface).toBe('cli'); // originator codex-tui → cli
  });

  it('emits user_prompt for user_message event', async () => {
    const events = await collectAll();
    const prompts = events.filter((e) => e.kind === 'user_prompt');
    expect(prompts).toHaveLength(1);
    if (prompts[0]?.kind !== 'user_prompt') throw new Error('unreachable');
    expect(prompts[0].textLength).toBeGreaterThan(0);
    expect(prompts[0].textHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits turn events with normalized usage and rate_limit', async () => {
    const events = await collectAll();
    const turns = events.filter((e) => e.kind === 'turn');
    expect(turns).toHaveLength(2);
    const first = turns[0];
    if (first?.kind !== 'turn') throw new Error('unreachable');
    expect(first.usage.newInputTokens).toBe(500); // 2000 - 1500
    expect(first.usage.cachedInputTokens).toBe(1500);
    expect(first.usage.outputTokens).toBe(100);
    expect(first.usage.reasoningTokens).toBe(50);
    expect(first.rateLimit?.primaryPercent).toBe(12.5);
    expect(first.rateLimit?.secondaryPercent).toBe(40);
  });

  it('captures the real model from turn_context (not the provider) on turns', async () => {
    const events = await collectAll();
    const turns = events.filter((e) => e.kind === 'turn');
    for (const t of turns) {
      if (t.kind !== 'turn') throw new Error('unreachable');
      expect(t.model).toBe('gpt-5.4');
    }
  });

  it('emits a compaction event for context_compacted', async () => {
    const events = await collectAll();
    const comps = events.filter((e) => e.kind === 'compaction');
    expect(comps).toHaveLength(1);
  });

  it('emits tool_call for exec_command_end, mcp_tool_call_end and function_call', async () => {
    const events = await collectAll();
    const calls = events.filter((e) => e.kind === 'tool_call');
    expect(calls).toHaveLength(3);
    const cats = new Set(calls.flatMap((c) => (c.kind === 'tool_call' ? [c.category] : [])));
    expect(cats.has('bash')).toBe(true);
    expect(cats.has('mcp')).toBe(true);
    expect(cats.has('native')).toBe(true);
  });
});

describe('indexCodexSessions', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-codex-'));
    dbPath = path.join(tmpDir, 'state_5.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'primary',
        model_provider TEXT NOT NULL DEFAULT 'openai',
        cwd TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        sandbox_policy TEXT NOT NULL DEFAULT '',
        approval_mode TEXT NOT NULL DEFAULT '',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        thread_source TEXT
      );
    `);
    const insert = db.prepare(`
      INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, tokens_used, model, thread_source)
      VALUES (@id, @rolloutPath, @createdAt, @updatedAt, @cwd, @tokens, @model, @threadSource)
    `);
    // base: 2026-05-15 00:00 UTC = 1779148800 (approximate)
    const t = 1779148800;
    insert.run({
      id: 'a-old',
      rolloutPath: '/tmp/r1.jsonl',
      createdAt: t - 30 * 86400,
      updatedAt: t - 30 * 86400 + 60,
      cwd: '/home/u/src/projA',
      tokens: 1000,
      model: 'gpt-5.4',
      threadSource: 'primary',
    });
    insert.run({
      id: 'a-recent',
      rolloutPath: '/tmp/r2.jsonl',
      createdAt: t - 2 * 86400,
      updatedAt: t - 2 * 86400 + 60,
      cwd: '/home/u/src/projA',
      tokens: 2000,
      model: 'gpt-5.5',
      threadSource: 'primary',
    });
    insert.run({
      id: 'b-recent',
      rolloutPath: '/tmp/r3.jsonl',
      createdAt: t - 1 * 86400,
      updatedAt: t - 1 * 86400 + 60,
      cwd: '/home/u/src/projB',
      tokens: 3000,
      model: 'gpt-5.5',
      threadSource: 'subagent',
    });
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all sessions when no filters given', () => {
    const rows = indexCodexSessions({ dbPath });
    expect(rows).toHaveLength(3);
  });

  it('filters by exact cwd', () => {
    const rows = indexCodexSessions({ dbPath, projectCwd: '/home/u/src/projB' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('b-recent');
    expect(rows[0]?.isSubagent).toBe(true);
  });

  it('filters by cwd prefix (trailing slash)', () => {
    const rows = indexCodexSessions({ dbPath, projectCwd: '/home/u/src/' });
    expect(rows).toHaveLength(3);
  });

  it('filters by since', () => {
    // base: 2026-05-15
    const since = new Date('2026-05-13T00:00:00Z');
    const rows = indexCodexSessions({ dbPath, since });
    // a-old is 30 days before; should be excluded.
    expect(rows.find((r) => r.id === 'a-old')).toBeUndefined();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('sorts by created_at desc', () => {
    const rows = indexCodexSessions({ dbPath });
    const ids = rows.map((r) => r.id);
    expect(ids[0]).toBe('b-recent'); // most recent
    expect(ids[ids.length - 1]).toBe('a-old');
  });
});
