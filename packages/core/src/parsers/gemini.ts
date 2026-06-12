/**
 * Parser for Gemini CLI chat stores.
 *
 * Observed layout (June 2026):
 *   ~/.gemini/tmp/<project-id>/.project_root
 *   ~/.gemini/tmp/<project-id>/chats/session-*.json[l]
 *   ~/.gemini/tmp/<project-id>/logs.json
 *
 * Chat files are the primary source. `logs.json` is a prompt-only fallback for
 * projects without readable chat files. Antigravity conversations are protobuf
 * (`*.pb`) or opaque SQLite sidecars in the observed corpus, so they are not
 * decoded here.
 */

import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

import type { SessionEvent, Usage } from '../schema.js';

const sha256short = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

export interface ParseGeminiChatOptions {
  filePath: string;
  projectCwd?: string;
  sessionId?: string;
}

export interface ParseGeminiLogOptions {
  filePath: string;
  projectCwd?: string;
}

export interface IndexGeminiOptions {
  /** Override `~/.gemini/tmp`. */
  tmpDir?: string;
  since?: Date;
  until?: Date;
  projectCwd?: string;
}

export interface GeminiIndexEntry {
  sessionId: string;
  filePath: string;
  projectCwd: string;
  startTs: string;
  updatedTs: string;
  kind: 'chat' | 'log';
}

interface GeminiSessionMeta {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  kind?: string;
  messages?: GeminiMessage[];
}

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  content?: unknown;
  thoughts?: unknown[];
  tokens?: {
    input?: number;
    output?: number;
    cached?: number;
    thoughts?: number;
    tool?: number;
    total?: number;
  };
  model?: string;
  toolCalls?: GeminiToolCall[];
}

interface GeminiToolCall {
  name?: string;
  status?: string;
}

interface GeminiLogRecord {
  sessionId?: string;
  type?: string;
  message?: string;
  timestamp?: string;
}

function defaultTmpDir(): string {
  return process.env['AGENT_STATS_GEMINI_TMP_DIR'] ?? path.join(process.env['HOME'] ?? '', '.gemini', 'tmp');
}

function matchesProject(cwd: string, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter.endsWith('/')) return cwd.startsWith(filter);
  return cwd === filter;
}

function normalizeUsage(tokens: GeminiMessage['tokens']): Usage {
  const input = tokens?.input ?? 0;
  const cached = tokens?.cached ?? 0;
  return {
    newInputTokens: Math.max(0, input - cached),
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: tokens?.output ?? 0,
    reasoningTokens: tokens?.thoughts ?? 0,
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const item of content) {
      if (typeof item === 'string') out += item;
      else if (item && typeof item === 'object') {
        const text = (item as Record<string, unknown>)['text'];
        if (typeof text === 'string') out += text;
      }
    }
    return out;
  }
  if (content && typeof content === 'object') {
    const text = (content as Record<string, unknown>)['text'];
    if (typeof text === 'string') return text;
  }
  return '';
}

function categorizeGeminiTool(name: string): 'bash' | 'mcp' | 'native' | 'function' | 'unknown' {
  const lower = name.toLowerCase();
  if (lower.includes('shell') || lower.includes('command') || lower === 'bash') return 'bash';
  if (lower.startsWith('mcp') || lower.includes('__')) return 'mcp';
  if (
    ['read', 'write', 'edit', 'file', 'grep', 'glob', 'search'].some((needle) =>
      lower.includes(needle),
    )
  )
    return 'native';
  return 'function';
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

async function readProjectRoot(projectDir: string): Promise<string> {
  try {
    return (await fs.readFile(path.join(projectDir, '.project_root'), 'utf8')).trim();
  } catch {
    return '';
  }
}

async function readGeminiChatFile(filePath: string): Promise<{
  meta: GeminiSessionMeta;
  messages: GeminiMessage[];
}> {
  if (filePath.endsWith('.jsonl')) {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const meta: GeminiSessionMeta = {};
    const messages: GeminiMessage[] = [];
    const seen = new Set<string>();

    const pushMessage = (msg: GeminiMessage): void => {
      const key = `${msg.id ?? ''}|${msg.type ?? ''}|${msg.timestamp ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      messages.push(msg);
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!rec || typeof rec !== 'object') continue;
      const o = rec as Record<string, unknown>;
      if (typeof o['sessionId'] === 'string') meta.sessionId = o['sessionId'];
      if (typeof o['projectHash'] === 'string') meta.projectHash = o['projectHash'];
      if (typeof o['startTime'] === 'string') meta.startTime = o['startTime'];
      if (typeof o['lastUpdated'] === 'string') meta.lastUpdated = o['lastUpdated'];
      if (typeof o['kind'] === 'string') meta.kind = o['kind'];

      const set = o['$set'];
      if (set && typeof set === 'object') {
        const setObj = set as Record<string, unknown>;
        if (typeof setObj['lastUpdated'] === 'string') meta.lastUpdated = setObj['lastUpdated'];
        if (Array.isArray(setObj['messages'])) {
          for (const msg of setObj['messages']) {
            if (msg && typeof msg === 'object') pushMessage(msg as GeminiMessage);
          }
        }
      }
      if (typeof o['type'] === 'string') pushMessage(o as GeminiMessage);
    }
    return { meta, messages };
  }

  const doc = JSON.parse(await fs.readFile(filePath, 'utf8')) as GeminiSessionMeta;
  return { meta: doc, messages: Array.isArray(doc.messages) ? doc.messages : [] };
}

function sessionIdFromFile(filePath: string): string {
  const base = path.basename(filePath).replace(/\.jsonl?$/, '');
  return base.startsWith('session-') ? base.slice('session-'.length) : base;
}

export async function* parseGeminiChat(
  opts: ParseGeminiChatOptions,
): AsyncGenerator<SessionEvent, void, unknown> {
  const { meta, messages } = await readGeminiChatFile(opts.filePath);
  const firstMessageTs = messages.map((m) => validIso(m.timestamp)).find(Boolean);
  const lastMessageTs = [...messages].reverse().map((m) => validIso(m.timestamp)).find(Boolean);
  const sessionId = opts.sessionId ?? meta.sessionId ?? sessionIdFromFile(opts.filePath);
  const projectCwd = opts.projectCwd ?? '';
  const startTs = validIso(meta.startTime) ?? firstMessageTs ?? new Date(0).toISOString();
  const endTs = validIso(meta.lastUpdated) ?? lastMessageTs ?? startTs;
  const firstModel = messages.find((m) => typeof m.model === 'string')?.model;

  yield {
    kind: 'session_start',
    ts: startTs,
    tool: 'gemini',
    sessionId,
    projectCwd,
    ...(firstModel ? { model: firstModel } : {}),
    isSubagent: false,
  };

  for (const msg of messages) {
    const ts = validIso(msg.timestamp) ?? startTs;
    const base = { tool: 'gemini' as const, sessionId, projectCwd, ts };
    if (msg.type === 'user') {
      const text = textFromContent(msg.content);
      if (text) {
        yield {
          ...base,
          kind: 'user_prompt',
          textLength: text.length,
          textHash: sha256short(text),
        };
      }
    } else if (msg.type === 'gemini') {
      if (msg.tokens) {
        yield {
          ...base,
          kind: 'turn',
          model: msg.model ?? 'unknown',
          usage: normalizeUsage(msg.tokens),
        };
      }
      if (Array.isArray(msg.toolCalls)) {
        for (const call of msg.toolCalls) {
          if (!call || typeof call.name !== 'string') continue;
          yield {
            ...base,
            kind: 'tool_call',
            name: call.name,
            category: categorizeGeminiTool(call.name),
            ...(call.status && call.status !== 'success' ? { error: true } : {}),
          };
        }
      }
    }
  }

  yield { kind: 'session_end', ts: endTs, tool: 'gemini', sessionId, projectCwd };
}

export async function* parseGeminiLog(
  opts: ParseGeminiLogOptions,
): AsyncGenerator<SessionEvent, void, unknown> {
  let records: GeminiLogRecord[];
  try {
    const raw = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as unknown;
    records = Array.isArray(raw) ? (raw as GeminiLogRecord[]) : [];
  } catch {
    return;
  }

  const groups = new Map<string, GeminiLogRecord[]>();
  for (const rec of records) {
    if (!rec.sessionId) continue;
    const list = groups.get(rec.sessionId) ?? [];
    list.push(rec);
    groups.set(rec.sessionId, list);
  }

  for (const [sessionId, list] of groups) {
    const sorted = list.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    const startTs = validIso(sorted[0]?.timestamp) ?? new Date(0).toISOString();
    const endTs = validIso(sorted.at(-1)?.timestamp) ?? startTs;
    const projectCwd = opts.projectCwd ?? '';
    yield {
      kind: 'session_start',
      ts: startTs,
      tool: 'gemini',
      sessionId,
      projectCwd,
      isSubagent: false,
    };
    for (const rec of sorted) {
      if (rec.type !== 'user' || typeof rec.message !== 'string' || !rec.message) continue;
      yield {
        kind: 'user_prompt',
        ts: validIso(rec.timestamp) ?? startTs,
        tool: 'gemini',
        sessionId,
        projectCwd,
        textLength: rec.message.length,
        textHash: sha256short(rec.message),
      };
    }
    yield { kind: 'session_end', ts: endTs, tool: 'gemini', sessionId, projectCwd };
  }
}

async function chatMetadata(filePath: string): Promise<{
  sessionId: string;
  startTs: string;
  updatedTs: string;
}> {
  const { meta, messages } = await readGeminiChatFile(filePath);
  const firstMessageTs = messages.map((m) => validIso(m.timestamp)).find(Boolean);
  const lastMessageTs = [...messages].reverse().map((m) => validIso(m.timestamp)).find(Boolean);
  const startTs = validIso(meta.startTime) ?? firstMessageTs ?? new Date(0).toISOString();
  return {
    sessionId: meta.sessionId ?? sessionIdFromFile(filePath),
    startTs,
    updatedTs: validIso(meta.lastUpdated) ?? lastMessageTs ?? startTs,
  };
}

async function logMetadata(filePath: string): Promise<{
  sessionId: string;
  startTs: string;
  updatedTs: string;
} | null> {
  let records: GeminiLogRecord[];
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    records = Array.isArray(raw) ? (raw as GeminiLogRecord[]) : [];
  } catch {
    return null;
  }
  const first = records.find((r) => typeof r.sessionId === 'string' && validIso(r.timestamp));
  if (!first?.sessionId) return null;
  const sorted = records
    .filter((r) => r.sessionId === first.sessionId)
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
  const startTs = validIso(sorted[0]?.timestamp) ?? new Date(0).toISOString();
  return {
    sessionId: first.sessionId,
    startTs,
    updatedTs: validIso(sorted.at(-1)?.timestamp) ?? startTs,
  };
}

function entryInWindow(entry: GeminiIndexEntry, since?: Date, until?: Date): boolean {
  const start = Date.parse(entry.startTs);
  const updated = Date.parse(entry.updatedTs);
  if (since && !Number.isNaN(updated) && updated < since.getTime()) return false;
  if (until && !Number.isNaN(start) && start > until.getTime()) return false;
  return true;
}

export async function indexGeminiSessions(
  opts: IndexGeminiOptions = {},
): Promise<GeminiIndexEntry[]> {
  const tmpDir = opts.tmpDir ?? defaultTmpDir();
  let projectDirs: Dirent[];
  try {
    projectDirs = await fs.readdir(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: GeminiIndexEntry[] = [];
  for (const projectDirent of projectDirs) {
    if (!projectDirent.isDirectory()) continue;
    const projectDir = path.join(tmpDir, projectDirent.name);
    const projectCwd = await readProjectRoot(projectDir);
    if (!matchesProject(projectCwd, opts.projectCwd)) continue;

    let chatFiles: string[] = [];
    try {
      chatFiles = (await fs.readdir(path.join(projectDir, 'chats'))).filter((f) =>
        /^session-.*\.jsonl?$/.test(f),
      );
    } catch {
      chatFiles = [];
    }

    for (const file of chatFiles) {
      const filePath = path.join(projectDir, 'chats', file);
      const meta = await chatMetadata(filePath);
      const entry = { ...meta, filePath, projectCwd, kind: 'chat' as const };
      if (entryInWindow(entry, opts.since, opts.until)) entries.push(entry);
    }

    if (chatFiles.length === 0) {
      const filePath = path.join(projectDir, 'logs.json');
      const meta = await logMetadata(filePath);
      if (meta) {
        const entry = { ...meta, filePath, projectCwd, kind: 'log' as const };
        if (entryInWindow(entry, opts.since, opts.until)) entries.push(entry);
      }
    }
  }

  return entries.sort((a, b) => a.startTs.localeCompare(b.startTs));
}

export async function* collectGeminiEvents(
  opts: IndexGeminiOptions = {},
): AsyncGenerator<SessionEvent, void, unknown> {
  const entries = await indexGeminiSessions(opts);
  for (const entry of entries) {
    if (entry.kind === 'chat') {
      yield* parseGeminiChat({
        filePath: entry.filePath,
        sessionId: entry.sessionId,
        projectCwd: entry.projectCwd,
      });
    } else {
      yield* parseGeminiLog({ filePath: entry.filePath, projectCwd: entry.projectCwd });
    }
  }
}
