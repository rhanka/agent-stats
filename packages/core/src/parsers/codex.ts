/**
 * Parser for Codex CLI session rollouts.
 *
 * Two-stage:
 *   1. `indexCodexSessions(opts)` queries `~/.codex/state_5.sqlite`
 *      (table `threads`) for sessions matching cwd / time-range filters and
 *      returns a list of `CodexIndexEntry` pointing to the rollout paths.
 *   2. `parseCodexRollout({filePath})` streams a single rollout jsonl and
 *      yields normalized `SessionEvent`s.
 *
 * Codex rollout top-level types seen in May 2026:
 *   session_meta, event_msg, response_item, compacted, turn_context.
 *
 * `event_msg.payload.type` sub-types include:
 *   token_count, agent_message, user_message, task_started, task_complete,
 *   turn_aborted, context_compacted, mcp_tool_call_begin / *_end,
 *   web_search_begin / *_end, exec_command_begin / *_end,
 *   patch_apply_begin / *_end.
 *
 * `response_item.payload.type` sub-types: message, function_call,
 * function_call_output, reasoning.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import Database from 'better-sqlite3';

import type { SessionEvent, Usage } from '../schema.js';
import { ZERO_USAGE } from '../schema.js';

// ---------------------------------------------------------------------------
// Index (sqlite)
// ---------------------------------------------------------------------------

export interface CodexIndexEntry {
  /** Thread id (uuid v7). */
  id: string;
  /** Absolute path to the rollout jsonl. */
  rolloutPath: string;
  /** Working directory at the time of the session. */
  cwd: string;
  /** Model id chosen at session create time (column added later; may be null). */
  model?: string;
  /** Unix seconds. */
  createdAt: number;
  updatedAt: number;
  /** Codex's running `tokens_used` counter for this thread. */
  tokensUsed: number;
  /** Whether this session source is `subagent`. */
  isSubagent: boolean;
}

export interface IndexCodexOptions {
  /** Path to state_5.sqlite (default: ~/.codex/state_5.sqlite). */
  dbPath?: string;
  /** Lower bound on created_at. */
  since?: Date;
  /** Upper bound on created_at. */
  until?: Date;
  /** Filter on cwd (exact or prefix; pass with trailing slash for prefix). */
  projectCwd?: string;
  /** Hard limit on number of returned entries. */
  limit?: number;
}

interface RawThreadRow {
  id: string;
  rollout_path: string;
  cwd: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  tokens_used: number;
  thread_source: string | null;
}

/**
 * Query the Codex threads DB and return matching session entries.
 *
 * The function opens the DB in readonly mode and never mutates anything.
 */
export function indexCodexSessions(opts: IndexCodexOptions = {}): CodexIndexEntry[] {
  const dbPath = opts.dbPath ?? `${process.env['HOME'] ?? ''}/.codex/state_5.sqlite`;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const conditions: string[] = [];
    const params: Record<string, number | string> = {};
    if (opts.since) {
      conditions.push('created_at >= $since');
      params['since'] = Math.floor(opts.since.getTime() / 1000);
    }
    if (opts.until) {
      conditions.push('created_at <= $until');
      params['until'] = Math.floor(opts.until.getTime() / 1000);
    }
    if (opts.projectCwd) {
      if (opts.projectCwd.endsWith('/')) {
        conditions.push('cwd LIKE $cwdPrefix');
        params['cwdPrefix'] = `${opts.projectCwd}%`;
      } else {
        conditions.push('cwd = $cwd');
        params['cwd'] = opts.projectCwd;
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : '';
    const sql = `
      SELECT
        id, rollout_path, cwd, model, created_at, updated_at, tokens_used,
        thread_source
      FROM threads
      ${where}
      ORDER BY created_at DESC
      ${limit}
    `;
    const rows = db.prepare(sql).all(params) as RawThreadRow[];
    return rows.map((r) => ({
      id: r.id,
      rolloutPath: r.rollout_path,
      cwd: r.cwd,
      ...(r.model !== null ? { model: r.model } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tokensUsed: r.tokens_used,
      isSubagent: r.thread_source === 'subagent',
    }));
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Rollout streaming parser
// ---------------------------------------------------------------------------

interface CodexUsageRaw {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexEventMsgPayload {
  type?: string;
  // token_count fields
  info?: { total_token_usage?: CodexUsageRaw; last_token_usage?: CodexUsageRaw };
  rate_limits?: {
    primary?: { used_percent?: number };
    secondary?: { used_percent?: number };
  };
  // mcp_tool_call_end fields
  server?: string;
  tool?: string;
  result?: unknown;
  // exec_command_end fields
  command?: unknown;
  stdout?: string;
  stderr?: string;
  aggregated_output?: string;
  exit_code?: number;
  // user_message fields
  message?: string;
}

interface CodexResponseItemPayload {
  type?: string;
  name?: string;
}

interface CodexSessionMetaPayload {
  id?: string;
  forked_from_id?: string;
  timestamp?: string;
  cwd?: string;
  cli_version?: string;
  agent_nickname?: string;
  model_provider?: string;
  source?: { subagent?: { thread_spawn?: { parent_thread_id?: string; depth?: number } } };
  thread_source?: string;
}

interface CodexTurnContextPayload {
  model?: string;
  cwd?: string;
}

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?:
    | CodexEventMsgPayload
    | CodexResponseItemPayload
    | CodexSessionMetaPayload
    | CodexTurnContextPayload
    | unknown;
}

function normalizeCodexUsage(raw: CodexUsageRaw | undefined): Usage {
  if (!raw) return ZERO_USAGE;
  const cached = raw.cached_input_tokens ?? 0;
  const total = raw.input_tokens ?? 0;
  return {
    newInputTokens: Math.max(0, total - cached),
    cachedInputTokens: cached,
    cacheWriteTokens: 0, // Codex doesn't expose cache writes separately.
    outputTokens: raw.output_tokens ?? 0,
    reasoningTokens: raw.reasoning_output_tokens ?? 0,
  };
}

const sha256short = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

function categorizeCodexTool(name: string): 'bash' | 'mcp' | 'native' | 'function' | 'unknown' {
  if (name.startsWith('mcp__') || name.startsWith('mcp_')) return 'mcp';
  if (name === 'shell' || name === 'exec_command' || name === 'bash') return 'bash';
  if (
    ['Read', 'Write', 'Edit', 'apply_patch', 'patch_apply', 'view_image'].some((n) =>
      name.includes(n),
    )
  )
    return 'native';
  return 'function';
}

export interface ParseCodexRolloutOptions {
  filePath: string;
  /** Optional sessionId/cwd override (when caller already has the index entry). */
  sessionId?: string;
  projectCwd?: string;
}

/**
 * Stream-parse a Codex rollout jsonl and yield normalized events.
 */
export async function* parseCodexRollout(
  opts: ParseCodexRolloutOptions,
): AsyncGenerator<SessionEvent, void, unknown> {
  const stream = createReadStream(opts.filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const fileBase = opts.filePath.split('/').pop() ?? opts.filePath;
  // rollout filenames are: rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
  const uuidMatch = fileBase.match(
    /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
  );
  let sessionId = opts.sessionId ?? uuidMatch?.[1] ?? fileBase.replace(/\.jsonl$/, '');
  let projectCwd = opts.projectCwd ?? '';
  let model = 'unknown';
  let lastTs: string | undefined;
  let startEmitted = false;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: CodexLine;
    try {
      rec = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }
    const ts = rec.timestamp ?? new Date(0).toISOString();
    lastTs = ts;
    const base = { tool: 'codex' as const, sessionId, projectCwd, ts };

    if (rec.type === 'session_meta') {
      const p = (rec.payload ?? {}) as CodexSessionMetaPayload;
      if (p.id) sessionId = p.id;
      if (p.cwd) projectCwd = p.cwd;
      const parentId = p.source?.subagent?.thread_spawn?.parent_thread_id;
      const depth = p.source?.subagent?.thread_spawn?.depth;
      const isSub = p.thread_source === 'subagent';
      yield {
        ...base,
        sessionId,
        projectCwd,
        kind: 'session_start',
        // NB: `model_provider` is just "openai" — the real model (gpt-5.x)
        // arrives later in `turn_context` events, so we don't set it here.
        ...(parentId ? { forkedFromId: parentId } : {}),
        ...(typeof depth === 'number' ? { subagentDepth: depth } : {}),
        ...(p.agent_nickname ? { agentNickname: p.agent_nickname } : {}),
        ...(p.cli_version ? { cliVersion: p.cli_version } : {}),
        isSubagent: isSub,
      };
      startEmitted = true;
      continue;
    }

    if (rec.type === 'turn_context') {
      // The actual model (gpt-5.4, gpt-5.3-codex, gpt-5.5, …) is declared per
      // turn here, not in session_meta. Track it so turns carry the right model
      // and the rate card can estimate cost.
      const p = (rec.payload ?? {}) as CodexTurnContextPayload;
      if (typeof p.model === 'string' && p.model) model = p.model;
      continue;
    }

    if (rec.type === 'event_msg') {
      const p = (rec.payload ?? {}) as CodexEventMsgPayload;
      switch (p.type) {
        case 'token_count': {
          const last = p.info?.last_token_usage;
          if (last && (last.input_tokens ?? 0) + (last.output_tokens ?? 0) > 0) {
            const rl1 = p.rate_limits?.primary?.used_percent;
            const rl2 = p.rate_limits?.secondary?.used_percent;
            yield {
              ...base,
              kind: 'turn',
              model,
              usage: normalizeCodexUsage(last),
              ...(p.info?.total_token_usage
                ? { cumulative: normalizeCodexUsage(p.info.total_token_usage) }
                : {}),
              ...(typeof rl1 === 'number' && typeof rl2 === 'number'
                ? { rateLimit: { primaryPercent: rl1, secondaryPercent: rl2 } }
                : {}),
            };
          }
          break;
        }
        case 'context_compacted':
          yield { ...base, kind: 'compaction' };
          break;
        case 'user_message': {
          const text = typeof p.message === 'string' ? p.message : '';
          if (text) {
            yield {
              ...base,
              kind: 'user_prompt',
              textLength: text.length,
              textHash: sha256short(text),
            };
          }
          break;
        }
        case 'mcp_tool_call_end': {
          const name = `mcp__${p.server ?? 'unknown'}__${p.tool ?? 'unknown'}`;
          const out = p.result ? JSON.stringify(p.result).length : 0;
          yield {
            ...base,
            kind: 'tool_call',
            name,
            category: 'mcp',
            outputBytes: out,
          };
          break;
        }
        case 'exec_command_end': {
          const out =
            (p.aggregated_output?.length ?? 0) + (p.stdout?.length ?? 0) + (p.stderr?.length ?? 0);
          const cmdArr = Array.isArray(p.command) ? p.command : [];
          const cmdName = typeof cmdArr[0] === 'string' ? cmdArr[0] : 'shell';
          yield {
            ...base,
            kind: 'tool_call',
            name: cmdName,
            category: 'bash',
            outputBytes: out,
            ...(typeof p.exit_code === 'number' && p.exit_code !== 0 ? { error: true } : {}),
          };
          break;
        }
        case 'web_search_end':
          yield {
            ...base,
            kind: 'tool_call',
            name: 'web_search',
            category: 'native',
          };
          break;
        default:
          break;
      }
      continue;
    }

    if (rec.type === 'response_item') {
      const p = (rec.payload ?? {}) as CodexResponseItemPayload;
      if (p.type === 'function_call' && typeof p.name === 'string') {
        yield {
          ...base,
          kind: 'tool_call',
          name: p.name,
          category: categorizeCodexTool(p.name),
        };
      }
      continue;
    }

    if (rec.type === 'compacted') {
      yield { ...base, kind: 'compaction' };
      continue;
    }
  }

  if (startEmitted && lastTs) {
    yield {
      kind: 'session_end',
      ts: lastTs,
      tool: 'codex',
      sessionId,
      projectCwd,
    };
  }
}
