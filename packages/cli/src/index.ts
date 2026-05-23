/**
 * @sentropic/agent-stats — CLI library entry.
 * The binary lives in ./cli.ts. WP4 wires the `stats` and `report`
 * subcommands; WP5+ will add the rest.
 */
export { VERSION } from '@sentropic/agent-stats-core';
export { runStats, type StatsCommandOptions, type StatsResult } from './commands/stats.js';
export { runReport, type ReportCommandOptions, type ReportResult } from './commands/report.js';
export { runClean, type CleanCommandOptions, type CleanCommandResult } from './commands/clean.js';
export {
  runAnomalies,
  type AnomaliesCommandOptions,
  type AnomaliesResult,
} from './commands/anomalies.js';
export {
  runWeb,
  startWebServer,
  type WebCommandOptions,
  type StartedWebServer,
} from './commands/web.js';
