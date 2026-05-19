/**
 * Parser for Claude Code session jsonl files
 * (`~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl`).
 *
 * Streams the file line-by-line and yields normalized `SessionEvent`s.
 *
 * Known top-level types (May 2026):
 *   assistant, user, attachment, permission-mode, ai-title, custom-title,
 *   agent-name, last-prompt, system, file-history-snapshot, queue-operation
 *
 * Known `message.content[]` sub-types:
 *   text, tool_use, tool_result, thinking, (raw string content)
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { SessionEvent, Usage } from '../schema.js';

interface ClaudeParseOptions {
  /** Absolute path of the session jsonl. Used to derive sessionId/projectCwd if not in the file. */
  filePath: string;
  /** Hard-cap on lines processed (for tests). */
  maxLines?: number;
}

interface ClaudeUsageRaw {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface ClaudeContentItem {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

interface ClaudeMessage {
  role?: 'user' | 'assistant';
  model?: string;
  content?: ClaudeContentItem[] | string;
  usage?: ClaudeUsageRaw;
}

interface ClaudeLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: ClaudeMessage;
  attachment?: { hookName?: string; hookEvent?: string };
}

const sha256short = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

function categorizeTool(name: string): 'bash' | 'mcp' | 'native' | 'function' | 'unknown' {
  if (name === 'Bash') return 'bash';
  if (name.startsWith('mcp__')) return 'mcp';
  if (
    ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch'].includes(
      name,
    )
  )
    return 'native';
  return 'unknown';
}

function normalizeUsage(raw: ClaudeUsageRaw | undefined): Usage {
  return {
    newInputTokens: raw?.input_tokens ?? 0,
    cachedInputTokens: raw?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw?.cache_creation_input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    reasoningTokens: 0, // Claude doesn't expose reasoning sub-count.
  };
}

/**
 * Parse a single Claude jsonl session file and yield normalized events.
 *
 * Notes:
 * - Emits a synthetic `session_start` from the first timestamped record.
 * - Emits `session_end` from the last record.
 * - The session id is derived from the filename (basename without extension).
 * - The project cwd is read from the first record that carries one, falling
 *   back to a sanitized form of the parent directory name.
 */
export async function* parseClaudeSession(
  opts: ClaudeParseOptions,
): AsyncGenerator<SessionEvent, void, unknown> {
  const stream = createReadStream(opts.filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const fileBase = opts.filePath.split('/').pop() ?? opts.filePath;
  const sessionIdFromFile = fileBase.replace(/\.jsonl$/, '');
  let sessionId = sessionIdFromFile;
  let projectCwd = '';
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let lineCount = 0;
  let startEmitted = false;

  // Defer the start event until we have at least one timestamp + cwd.
  const buffer: SessionEvent[] = [];

  function flush(): SessionEvent[] {
    const out = buffer.splice(0);
    return out;
  }

  for await (const line of rl) {
    lineCount += 1;
    if (opts.maxLines !== undefined && lineCount > opts.maxLines) break;
    if (!line.trim()) continue;

    let rec: ClaudeLine;
    try {
      rec = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }

    if (rec.sessionId) sessionId = rec.sessionId;
    if (rec.cwd) projectCwd = rec.cwd;

    const ts = rec.timestamp;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    // Emit session_start lazily once we have ts + cwd (or first ts at least).
    if (!startEmitted && firstTs) {
      startEmitted = true;
      const startEvent: SessionEvent = {
        kind: 'session_start',
        ts: firstTs,
        tool: 'claude',
        sessionId,
        projectCwd,
        isSubagent: false, // Claude Task sub-agents would be detected differently.
      };
      buffer.push(startEvent);
    }

    const recTs = ts ?? firstTs ?? new Date(0).toISOString();
    const base = { tool: 'claude' as const, sessionId, projectCwd, ts: recTs };

    // user / assistant turn record (carries `message`)
    if (rec.type === 'assistant' && rec.message) {
      const msg = rec.message;
      // Emit tool_use / tool_result / skill_invoke from content[]
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === 'tool_use' && c.name) {
            buffer.push({
              ...base,
              kind: 'tool_call',
              name: c.name,
              category: categorizeTool(c.name),
              inputBytes: c.input ? JSON.stringify(c.input).length : 0,
            });
          }
        }
      }
      // Emit turn event when usage is present.
      if (msg.usage) {
        buffer.push({
          ...base,
          kind: 'turn',
          model: msg.model ?? 'unknown',
          usage: normalizeUsage(msg.usage),
        });
      }
    } else if (rec.type === 'user' && rec.message) {
      const msg = rec.message;
      // user message can be string OR array of content items; extract text length + hash
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      }
      if (text) {
        buffer.push({
          ...base,
          kind: 'user_prompt',
          textLength: text.length,
          textHash: sha256short(text),
        });
      }
    } else if (rec.type === 'attachment') {
      // Detect SessionStart hooks for skill invocations.
      const hookName = rec.attachment?.hookName ?? '';
      if (hookName.startsWith('Skill') || hookName === 'SessionStart:startup') {
        // No-op for now; skills are tracked through tool_use of Skill tool.
      }
    }

    yield* flush();
  }

  if (lastTs && startEmitted) {
    yield {
      kind: 'session_end',
      ts: lastTs,
      tool: 'claude',
      sessionId,
      projectCwd,
    };
  }
}
