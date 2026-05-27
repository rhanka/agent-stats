/**
 * Common schema for events extracted from agentic CLI sessions
 * (Claude Code, Codex CLI). Parsers produce streams of `SessionEvent`s;
 * aggregations consume that normalized shape.
 *
 * Design choices:
 * - `Usage` is unified across providers. New/cached/cache-write are split
 *   so callers can apply the right rate. Reasoning is a sub-count of
 *   output_tokens (consistent with Codex server-side behaviour).
 * - All timestamps are ISO 8601 UTC. Parsers MUST normalize.
 * - `kind` is the discriminant; the union is exhaustive (use `assertNever`).
 */

export type Tool = 'claude' | 'codex' | 'cursor';

/** Which local surface produced the session (mainly to split Codex). */
export type Surface = 'cli' | 'vscode' | 'exec' | 'cursor';

/**
 * Token usage breakdown for a single turn.
 * Pricing semantics (typical providers, May 2026):
 *   newInputTokens   = full price input
 *   cachedInputTokens = read from cache, ~10% of full price
 *   cacheWriteTokens = written to cache (Anthropic only), ~125% of full price
 *   outputTokens     = generated tokens, full output price
 *   reasoningTokens  = subset of outputTokens, charged at output rate
 */
export interface Usage {
  newInputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const ZERO_USAGE: Usage = {
  newInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    newInputTokens: a.newInputTokens + b.newInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** Total input tokens processed (regardless of pricing). */
export function totalInputTokens(u: Usage): number {
  return u.newInputTokens + u.cachedInputTokens + u.cacheWriteTokens;
}

/** Shared fields on every `SessionEvent`. */
export interface EventBase {
  ts: string; // ISO 8601 UTC
  tool: Tool;
  sessionId: string;
  projectCwd: string;
}

/** Emitted once at the start of a session. */
export interface SessionStartEvent extends EventBase {
  kind: 'session_start';
  model?: string;
  /** Codex: parent thread id when this session is a subagent fork. */
  forkedFromId?: string;
  /** Codex: depth in the subagent tree (0 = top-level). */
  subagentDepth?: number;
  /** Codex: nickname auto-assigned to subagents (philosopher names). */
  agentNickname?: string;
  cliVersion?: string;
  /** Local surface (Codex CLI/VSCode/exec, or Cursor), derived from originator. */
  surface?: Surface;
  /** True if originated from a parent thread (Codex fork or Claude Task). */
  isSubagent: boolean;
}

/** Emitted once at the end of a session. */
export interface SessionEndEvent extends EventBase {
  kind: 'session_end';
}

/**
 * An assistant turn that produced token usage.
 * Emitted once per assistant API response.
 */
export interface TurnEvent extends EventBase {
  kind: 'turn';
  model: string;
  usage: Usage;
  /** Codex `total_token_usage` if present (running total at this point). */
  cumulative?: Usage;
  /** Codex rate-limit reading at this turn (general window). */
  rateLimit?: {
    primaryPercent: number; // 5h window
    secondaryPercent: number; // 7d window
  };
}

/** A user prompt or message. */
export interface UserPromptEvent extends EventBase {
  kind: 'user_prompt';
  textLength: number;
  /** Short hash for dedup; never the raw text. */
  textHash: string;
}

/** A tool invocation (Bash, MCP, native file ops, etc.). */
export interface ToolCallEvent extends EventBase {
  kind: 'tool_call';
  name: string;
  category: 'bash' | 'mcp' | 'native' | 'function' | 'unknown';
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  error?: boolean;
}

/** A skill (slash-skill) invocation. */
export interface SkillInvokeEvent extends EventBase {
  kind: 'skill_invoke';
  name: string;
}

/** Auto-compaction (context window full). */
export interface CompactionEvent extends EventBase {
  kind: 'compaction';
}

/** Discriminated union of every event type. */
export type SessionEvent =
  | SessionStartEvent
  | SessionEndEvent
  | TurnEvent
  | UserPromptEvent
  | ToolCallEvent
  | SkillInvokeEvent
  | CompactionEvent;

/**
 * Aggregated metadata for a session, computed by `collect()` from the
 * stream of events.
 */
export interface SessionMeta {
  sessionId: string;
  tool: Tool;
  projectCwd: string;
  model?: string;
  startTs: string;
  endTs: string;
  durationMs: number;
  turns: number;
  totalUsage: Usage;
  isSubagent: boolean;
  forkedFromId?: string;
  agentNickname?: string;
  toolCalls: number;
  compactions: number;
  /** Max rate-limit % seen in the session (Codex). */
  rateLimitMax?: {
    primaryPercent: number;
    secondaryPercent: number;
  };
}

/** Project-level info, derived from cwd. */
export interface ProjectInfo {
  cwd: string;
  /** Short label derived from cwd basename. */
  name: string;
  /** Sibling repos under the same parent dir (for cross-repo storage). */
  siblings?: Record<string, string>;
}

/** Used in switch/case exhaustiveness. */
export function assertNever(x: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(x)}`);
}
