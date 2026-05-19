/**
 * @sentropic/agent-stats-core
 *
 * Public surface: schema types and parsers.
 */

export const VERSION = '0.0.0';

export * from './schema.js';
export { parseClaudeSession } from './parsers/claude.js';
export {
  indexCodexSessions,
  parseCodexRollout,
  type CodexIndexEntry,
  type IndexCodexOptions,
  type ParseCodexRolloutOptions,
} from './parsers/codex.js';
export { collect, decodeClaudeProjectDir, type CollectOptions } from './collect.js';
