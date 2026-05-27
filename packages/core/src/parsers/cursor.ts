/**
 * Cursor parser. Cursor stores its chat history in a single global SQLite DB
 * (`~/.config/Cursor/User/globalStorage/state.vscdb`, table `cursorDiskKV`):
 *   - `composerData:<id>`  → a session (createdAt ms, fullConversationHeadersOnly,
 *                            context with attached file URIs).
 *   - `bubbleId:<composerId>:<bubbleId>` → a message (type 1=user, 2=assistant,
 *                            tokenCount: { inputTokens, outputTokens }).
 *
 * Cursor exposes neither the model nor a cost/credit, so cursor rows carry
 * tokens + sessions + messages only (model `unknown` → estimateCost = 0).
 *
 * The schema is undocumented, so every access is defensive.
 */

import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { SessionEvent, Usage } from '../schema.js';

const sha256short = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

export interface IndexCursorOptions {
  /** Override `~/.config/Cursor/User`. */
  cursorStateDir?: string;
  since?: Date;
  until?: Date;
  projectCwd?: string;
}

export interface CursorIndexEntry {
  sessionId: string;
  createdAt: number; // epoch ms
  ts: string; // ISO
  projectCwd: string;
}

function defaultStateDir(): string {
  // Env override lets the test suite point at an empty dir so collect() does
  // not read the real ~/.config/Cursor during tests.
  return (
    process.env['AGENT_STATS_CURSOR_DIR'] ?? path.join(os.homedir(), '.config', 'Cursor', 'User')
  );
}

export function defaultCursorDbPath(stateDir?: string): string {
  return path.join(stateDir ?? defaultStateDir(), 'globalStorage', 'state.vscdb');
}

function parseJson(v: unknown): unknown {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : null;
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Recursively collect `file://` URIs / absolute paths from a composer's context. */
function collectFilePaths(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 200) return;
  if (typeof node === 'string') {
    if (node.startsWith('file:///')) {
      try {
        out.push(decodeURIComponent(node.slice('file://'.length)));
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectFilePaths(v, out, depth + 1);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectFilePaths(v, out, depth + 1);
    }
  }
}

/** Longest common directory of a set of absolute file paths. */
function commonDir(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/'));
  const first = split[0] ?? [];
  let i = 0;
  for (; i < first.length; i++) {
    const seg = first[i];
    if (!split.every((s) => s[i] === seg)) break;
  }
  const dir = first.slice(0, i).join('/');
  // Drop a trailing filename component (has a dot, no further children agreed on).
  return dir;
}

function projectFromComposer(composer: Record<string, unknown>): string {
  const paths: string[] = [];
  collectFilePaths(composer['context'], paths);
  collectFilePaths(composer['allAttachedFileCodeChunksUris'], paths);
  if (paths.length === 0) return '';
  const dir = commonDir(paths);
  // If the common prefix is itself a file (single file selected), use its dir.
  const last = dir.split('/').pop() ?? '';
  return last.includes('.') ? dir.slice(0, dir.lastIndexOf('/')) : dir;
}

function matchesProject(cwd: string, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter.endsWith('/')) return cwd.startsWith(filter);
  return cwd === filter;
}

/**
 * Read composer sessions from the Cursor global DB. Returns metadata only;
 * call `parseCursorComposer` to stream a session's events.
 */
export function indexCursorSessions(opts: IndexCursorOptions = {}): CursorIndexEntry[] {
  const dbPath = defaultCursorDbPath(opts.cursorStateDir);
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    const rows = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all() as { key: string; value: unknown }[];
    const entries: CursorIndexEntry[] = [];
    for (const row of rows) {
      const o = parseJson(row.value);
      if (!o || typeof o !== 'object') continue;
      const composer = o as Record<string, unknown>;
      const id =
        typeof composer['composerId'] === 'string'
          ? composer['composerId']
          : row.key.slice('composerData:'.length);
      const createdAt = typeof composer['createdAt'] === 'number' ? composer['createdAt'] : 0;
      if (createdAt <= 0) continue;
      const when = new Date(createdAt);
      if (opts.since && when < opts.since) continue;
      if (opts.until && when > opts.until) continue;
      const projectCwd = projectFromComposer(composer);
      if (!matchesProject(projectCwd, opts.projectCwd)) continue;
      entries.push({ sessionId: id, createdAt, ts: when.toISOString(), projectCwd });
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

interface CursorBubble {
  type?: number; // 1 = user, 2 = assistant
  text?: string;
  tokenCount?: { inputTokens?: number; outputTokens?: number };
}

function bubbleUsage(b: CursorBubble): Usage {
  const tc = b.tokenCount ?? {};
  return {
    newInputTokens: tc.inputTokens ?? 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: tc.outputTokens ?? 0,
    reasoningTokens: 0,
  };
}

/**
 * Stream the events of one composer session. Needs an open DB handle (so the
 * caller can reuse it across sessions).
 */
export function parseCursorComposer(
  db: Database.Database,
  entry: CursorIndexEntry,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  const base = {
    tool: 'cursor' as const,
    sessionId: entry.sessionId,
    projectCwd: entry.projectCwd,
    ts: entry.ts,
  };
  events.push({ ...base, kind: 'session_start', surface: 'cursor', isSubagent: false });

  const composerRow = db
    .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
    .get(`composerData:${entry.sessionId}`) as { value: unknown } | undefined;
  const composer = (parseJson(composerRow?.value) ?? {}) as Record<string, unknown>;
  const headers = Array.isArray(composer['fullConversationHeadersOnly'])
    ? (composer['fullConversationHeadersOnly'] as { bubbleId?: string }[])
    : [];

  const getBubble = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
  for (const h of headers) {
    const bubbleId = h?.bubbleId;
    if (!bubbleId) continue;
    const row = getBubble.get(`bubbleId:${entry.sessionId}:${bubbleId}`) as
      | { value: unknown }
      | undefined;
    const b = parseJson(row?.value) as CursorBubble | null;
    if (!b || typeof b !== 'object') continue;
    if (b.type === 1) {
      const text = typeof b.text === 'string' ? b.text : '';
      events.push({
        ...base,
        kind: 'user_prompt',
        textLength: text.length,
        textHash: sha256short(text),
      });
    } else if (b.type === 2) {
      events.push({ ...base, kind: 'turn', model: 'unknown', usage: bubbleUsage(b) });
    }
  }

  events.push({ ...base, kind: 'session_end' });
  return events;
}

/** Open the DB once and yield events for all matching composer sessions. */
export async function* collectCursorEvents(
  opts: IndexCursorOptions = {},
): AsyncGenerator<SessionEvent, void, unknown> {
  const entries = indexCursorSessions(opts);
  if (entries.length === 0) return;
  const dbPath = defaultCursorDbPath(opts.cursorStateDir);
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return;
  }
  try {
    for (const entry of entries) {
      for (const ev of parseCursorComposer(db, entry)) yield ev;
    }
  } finally {
    db.close();
  }
}
