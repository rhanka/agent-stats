/**
 * `agent-stats anomalies` — run heuristic anomaly detection over a date
 * range. Outputs either JSON (default) or a compact table.
 */

import {
  collect,
  detectAnomalies,
  type Anomaly,
  type AnomalySeverity,
  type CollectOptions,
} from '@sentropic/agent-stats-core';

export interface AnomaliesCommandOptions {
  since?: string;
  until?: string;
  tool?: 'claude' | 'codex' | 'cursor';
  project?: string;
  format?: 'json' | 'table';
  claudeProjectsDir?: string;
  codexDbPath?: string;
  cursorStateDir?: string;
}

export interface AnomaliesResult {
  output: string;
  anomalies: Anomaly[];
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --${label} value: ${value} (expected ISO 8601)`);
  }
  return d;
}

function renderTable(items: Anomaly[]): string {
  if (items.length === 0) return '(no anomalies)';
  const headers = ['type', 'sev', 'tool', 'project', 'session', 'evidence'];
  const lines: string[][] = [headers];
  for (const a of items) {
    lines.push([
      a.type,
      a.severity,
      a.tool,
      a.projectCwd,
      a.sessionId.slice(0, 8),
      JSON.stringify(a.evidence),
    ]);
  }
  const widths = headers.map((_, i) => Math.max(...lines.map((l) => (l[i] ?? '').length)));
  const fmt = (l: string[]): string => l.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  const out = [fmt(headers), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (let i = 1; i < lines.length; i++) out.push(fmt(lines[i] ?? []));
  return out.join('\n');
}

export async function runAnomalies(opts: AnomaliesCommandOptions = {}): Promise<AnomaliesResult> {
  const collectOpts: CollectOptions = {};
  const since = parseDate(opts.since, 'since');
  const until = parseDate(opts.until, 'until');
  if (since !== undefined) collectOpts.since = since;
  if (until !== undefined) collectOpts.until = until;
  if (opts.project !== undefined) collectOpts.projectCwd = opts.project;
  if (opts.claudeProjectsDir !== undefined) collectOpts.claudeProjectsDir = opts.claudeProjectsDir;
  if (opts.codexDbPath !== undefined) collectOpts.codexDbPath = opts.codexDbPath;
  if (opts.cursorStateDir !== undefined) collectOpts.cursorStateDir = opts.cursorStateDir;
  if (opts.tool) {
    collectOpts.sources = {
      claude: opts.tool === 'claude',
      codex: opts.tool === 'codex',
      cursor: opts.tool === 'cursor',
    };
  }
  const anomalies = await detectAnomalies(collect(collectOpts));
  // Sort: severity (high → low), then type, then session id
  const sevRank: Record<AnomalySeverity, number> = { high: 3, medium: 2, low: 1 };
  anomalies.sort((a: Anomaly, b: Anomaly) => {
    const sv = sevRank[b.severity] - sevRank[a.severity];
    if (sv !== 0) return sv;
    return a.type.localeCompare(b.type) || a.sessionId.localeCompare(b.sessionId);
  });
  const format = opts.format ?? 'json';
  const output = format === 'table' ? renderTable(anomalies) : JSON.stringify(anomalies, null, 2);
  return { output, anomalies };
}
