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
export {
  aggregateSessions,
  aggregateWeekly,
  bucketWeekly,
  cacheEfficiency,
  weekStartIso,
  type AggregateOptions,
  type SessionAggregate,
  type WeeklyAggregation,
} from './aggregations.js';
export {
  DEFAULT_RATE_CARD,
  ZERO_RATES,
  estimateCost,
  resolveRates,
  type CostCurrency,
  type ModelRates,
} from './rate-card.js';
export {
  JsonStorage,
  type JsonStorageOptions,
  type StorageAdapter,
  type StorageFilter,
} from './storage.js';
