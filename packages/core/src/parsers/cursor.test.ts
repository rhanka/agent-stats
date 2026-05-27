import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  indexCursorSessions,
  parseCursorComposer,
  defaultCursorDbPath,
  type CursorIndexEntry,
} from './cursor.js';

let stateDir: string;

function composer(id: string, createdAt: number, fileUri: string, bubbles: { id: string; type: number }[]) {
  return {
    composerId: id,
    createdAt,
    allAttachedFileCodeChunksUris: [fileUri],
    context: { fileSelections: [{ uri: fileUri }] },
    fullConversationHeadersOnly: bubbles.map((b) => ({ bubbleId: b.id, type: b.type })),
  };
}

beforeAll(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), 'cursor-test-'));
  mkdirSync(path.join(stateDir, 'globalStorage'), { recursive: true });
  const db = new Database(defaultCursorDbPath(stateDir));
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
  const put = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');

  // Composer A — projA, one user + one assistant turn with tokens.
  put.run(
    'composerData:aaa',
    JSON.stringify(
      composer('aaa', 1_746_300_000_000, 'file:///home/u/src/projA/src/index.ts', [
        { id: 'u1', type: 1 },
        { id: 'a1', type: 2 },
      ]),
    ),
  );
  put.run('bubbleId:aaa:u1', JSON.stringify({ type: 1, text: 'fix the bug please' }));
  put.run(
    'bubbleId:aaa:a1',
    JSON.stringify({ type: 2, text: 'done', tokenCount: { inputTokens: 4596, outputTokens: 232 } }),
  );

  // Composer B — projB, two assistant turns (token sum), created later.
  put.run(
    'composerData:bbb',
    JSON.stringify(
      composer('bbb', 1_746_400_000_000, 'file:///home/u/src/projB/main.py', [
        { id: 'a1', type: 2 },
        { id: 'a2', type: 2 },
      ]),
    ),
  );
  put.run('bubbleId:bbb:a1', JSON.stringify({ type: 2, tokenCount: { inputTokens: 100, outputTokens: 10 } }));
  put.run('bubbleId:bbb:a2', JSON.stringify({ type: 2, tokenCount: { inputTokens: 200, outputTokens: 20 } }));

  // A null/garbage composer value must be skipped, not crash.
  put.run('composerData:zzz', 'not json');
  db.close();
});

afterAll(() => rmSync(stateDir, { recursive: true, force: true }));

describe('indexCursorSessions', () => {
  it('returns composer sessions sorted by createdAt with project from file URIs', () => {
    const entries = indexCursorSessions({ cursorStateDir: stateDir });
    expect(entries.map((e) => e.sessionId)).toEqual(['aaa', 'bbb']);
    expect(entries[0]?.projectCwd).toBe('/home/u/src/projA/src');
    expect(entries[1]?.projectCwd).toBe('/home/u/src/projB');
    expect(entries[0]?.tool ?? 'cursor').toBe('cursor');
  });

  it('applies the project filter', () => {
    const entries = indexCursorSessions({ cursorStateDir: stateDir, projectCwd: '/home/u/src/projB' });
    expect(entries.map((e) => e.sessionId)).toEqual(['bbb']);
  });

  it('returns [] when the DB is missing', () => {
    expect(indexCursorSessions({ cursorStateDir: '/no/such/dir' })).toEqual([]);
  });
});

describe('parseCursorComposer', () => {
  function eventsFor(id: string): ReturnType<typeof parseCursorComposer> {
    const db = new Database(defaultCursorDbPath(stateDir), { readonly: true });
    try {
      const entry = indexCursorSessions({ cursorStateDir: stateDir }).find((e) => e.sessionId === id)!;
      return parseCursorComposer(db, entry as CursorIndexEntry);
    } finally {
      db.close();
    }
  }

  it('emits session_start (cursor surface) + user_prompt + turn + session_end', () => {
    const ev = eventsFor('aaa');
    expect(ev.map((e) => e.kind)).toEqual(['session_start', 'user_prompt', 'turn', 'session_end']);
    const start = ev[0];
    if (start?.kind !== 'session_start') throw new Error('unreachable');
    expect(start.tool).toBe('cursor');
    expect(start.surface).toBe('cursor');
    const turn = ev[2];
    if (turn?.kind !== 'turn') throw new Error('unreachable');
    expect(turn.usage.newInputTokens).toBe(4596);
    expect(turn.usage.outputTokens).toBe(232);
    const prompt = ev[1];
    if (prompt?.kind !== 'user_prompt') throw new Error('unreachable');
    expect(prompt.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(prompt.textLength).toBe('fix the bug please'.length);
  });

  it('keeps both assistant turns (tokens not collapsed)', () => {
    const turns = eventsFor('bbb').filter((e) => e.kind === 'turn');
    expect(turns).toHaveLength(2);
  });
});
