/**
 * @sentropic/agent-stats-core
 *
 * Public surface: schema types and parsers.
 */

export const VERSION = '0.1.0';

export * from './schema.js';
export { parseClaudeSession } from './parsers/claude.js';
export {
  indexCodexSessions,
  parseCodexRollout,
  type CodexIndexEntry,
  type IndexCodexOptions,
  type ParseCodexRolloutOptions,
} from './parsers/codex.js';
export {
  indexCursorSessions,
  parseCursorComposer,
  collectCursorEvents,
  defaultCursorDbPath,
  type CursorIndexEntry,
  type IndexCursorOptions,
} from './parsers/cursor.js';
export { collect, decodeClaudeProjectDir, type CollectOptions } from './collect.js';
export {
  periodSeries,
  weeklySeries,
  type SeriesMetric,
  type ToolFilter,
  type SeriesRow,
  type SeriesPoint,
} from './series.js';
export {
  aggregateSessions,
  aggregateWeekly,
  aggregateByPeriod,
  bucketWeekly,
  bucketBy,
  cacheEfficiency,
  weekStartIso,
  dayStartIso,
  type AggregateOptions,
  type SessionAggregate,
  type WeeklyAggregation,
  type Granularity,
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
export { scanString, type SecretMatch } from './secrets.js';
export { cleanFile, type CleanFileOptions, type CleanMode, type CleanStats } from './cleanser.js';
export {
  detectAnomalies,
  type Anomaly,
  type AnomalySeverity,
  type AnomalyType,
  type DetectAnomaliesOptions,
} from './anomalies.js';
export {
  analyzeWithLlm,
  benchModels,
  type AnalysisVerdict,
  type AnalyzeCache,
  type AnalyzeOptions,
  type BenchModelConfig,
  type BenchModelResult,
  type BenchOptions,
  type BenchSampleBaseline,
  type LlmMeshLike,
} from './analyze.js';
