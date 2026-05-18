/**
 * @sentropic/agent-stats-core
 *
 * Entry point. The real API surface lands in WP2-WP3.
 */

export const VERSION = '0.0.0';

export type Tool = 'claude' | 'codex';

export interface SessionEventBase {
  ts: string; // ISO 8601
  tool: Tool;
  sessionId: string;
  projectCwd: string;
}

// Stubs to be fleshed out in WP2.
export type SessionEvent = SessionEventBase & { kind: string; [k: string]: unknown };
