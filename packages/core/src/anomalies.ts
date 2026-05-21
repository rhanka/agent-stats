/**
 * Anomaly detection heuristics (no LLM).
 *
 * Operates on a stream of `SessionEvent`s and emits `Anomaly` records
 * flagging sessions that exhibit known costly or stuck patterns:
 *   - runaway_compactions : auto-compaction triggered N+ times in one session.
 *   - high_error_rate     : tool error rate > threshold (min 10 calls).
 *   - prompt_retry_loop   : same user prompt textHash repeated N+ times.
 *   - tool_loop           : same tool name called N+ times consecutively.
 *   - zombie_session      : > N minutes between consecutive turns.
 *
 * Frustration via user-prompt content is intentionally out of scope for
 * WP5; the parser stores only prompt hashes (privacy). That heuristic
 * is deferred to WP7 (LLM phase 2).
 */

import type { SessionEvent } from './schema.js';

export type AnomalyType =
  | 'runaway_compactions'
  | 'high_error_rate'
  | 'prompt_retry_loop'
  | 'tool_loop'
  | 'zombie_session';

export type AnomalySeverity = 'low' | 'medium' | 'high';

export interface Anomaly {
  sessionId: string;
  tool: 'claude' | 'codex';
  projectCwd: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  /** Free-form, machine-readable evidence. */
  evidence: Record<string, number | string>;
}

export interface DetectAnomaliesOptions {
  runawayCompactions?: number; // default: 10
  errorRateThreshold?: number; // default: 0.3 (30%)
  minToolCallsForErrorRate?: number; // default: 10
  promptRetryCount?: number; // default: 4
  toolLoopCount?: number; // default: 5
  zombieGapMinutes?: number; // default: 120
}

interface SessionAcc {
  sessionId: string;
  tool: 'claude' | 'codex';
  projectCwd: string;
  compactions: number;
  toolCallTotal: number;
  toolCallErrors: number;
  promptHashCounts: Map<string, number>;
  lastToolName: string;
  lastToolStreak: number;
  maxToolStreak: { name: string; count: number };
  turnTs: string[];
}

function emptyAcc(ev: SessionEvent): SessionAcc {
  return {
    sessionId: ev.sessionId,
    tool: ev.tool,
    projectCwd: ev.projectCwd,
    compactions: 0,
    toolCallTotal: 0,
    toolCallErrors: 0,
    promptHashCounts: new Map(),
    lastToolName: '',
    lastToolStreak: 0,
    maxToolStreak: { name: '', count: 0 },
    turnTs: [],
  };
}

function severityFromRatio(ratio: number): AnomalySeverity {
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

export async function detectAnomalies(
  events: AsyncIterable<SessionEvent> | Iterable<SessionEvent>,
  opts: DetectAnomaliesOptions = {},
): Promise<Anomaly[]> {
  const runawayCompactions = opts.runawayCompactions ?? 10;
  const errorRateThreshold = opts.errorRateThreshold ?? 0.3;
  const minToolCallsForErrorRate = opts.minToolCallsForErrorRate ?? 10;
  const promptRetryCount = opts.promptRetryCount ?? 4;
  const toolLoopCount = opts.toolLoopCount ?? 5;
  const zombieGapMinutes = opts.zombieGapMinutes ?? 120;

  const sessions = new Map<string, SessionAcc>();

  for await (const ev of events) {
    if (!ev.sessionId) continue;
    let s = sessions.get(ev.sessionId);
    if (!s) {
      s = emptyAcc(ev);
      sessions.set(ev.sessionId, s);
    }
    // Update fields shared by all session events
    if (ev.projectCwd) s.projectCwd = ev.projectCwd;
    s.tool = ev.tool;

    switch (ev.kind) {
      case 'compaction':
        s.compactions += 1;
        break;
      case 'tool_call': {
        s.toolCallTotal += 1;
        if (ev.error) s.toolCallErrors += 1;
        if (ev.name === s.lastToolName) {
          s.lastToolStreak += 1;
        } else {
          s.lastToolName = ev.name;
          s.lastToolStreak = 1;
        }
        if (s.lastToolStreak > s.maxToolStreak.count) {
          s.maxToolStreak = { name: ev.name, count: s.lastToolStreak };
        }
        break;
      }
      case 'user_prompt': {
        s.promptHashCounts.set(ev.textHash, (s.promptHashCounts.get(ev.textHash) ?? 0) + 1);
        // user prompts also break tool streaks
        s.lastToolName = '';
        s.lastToolStreak = 0;
        break;
      }
      case 'turn': {
        if (ev.ts) s.turnTs.push(ev.ts);
        // turns also break tool streaks (different assistant action)
        s.lastToolName = '';
        s.lastToolStreak = 0;
        break;
      }
      case 'session_start':
      case 'session_end':
      case 'skill_invoke':
        break;
    }
  }

  const anomalies: Anomaly[] = [];

  for (const s of sessions.values()) {
    if (s.compactions >= runawayCompactions) {
      anomalies.push({
        sessionId: s.sessionId,
        tool: s.tool,
        projectCwd: s.projectCwd,
        type: 'runaway_compactions',
        severity: severityFromRatio(s.compactions / runawayCompactions),
        evidence: { compactions: s.compactions, threshold: runawayCompactions },
      });
    }
    if (s.toolCallTotal >= minToolCallsForErrorRate) {
      const rate = s.toolCallErrors / s.toolCallTotal;
      if (rate >= errorRateThreshold) {
        anomalies.push({
          sessionId: s.sessionId,
          tool: s.tool,
          projectCwd: s.projectCwd,
          type: 'high_error_rate',
          severity: severityFromRatio(rate / errorRateThreshold),
          evidence: {
            errors: s.toolCallErrors,
            total: s.toolCallTotal,
            rate: Number(rate.toFixed(3)),
            threshold: errorRateThreshold,
          },
        });
      }
    }
    let topHash = '';
    let topHashCount = 0;
    for (const [h, n] of s.promptHashCounts) {
      if (n > topHashCount) {
        topHashCount = n;
        topHash = h;
      }
    }
    if (topHashCount >= promptRetryCount) {
      anomalies.push({
        sessionId: s.sessionId,
        tool: s.tool,
        projectCwd: s.projectCwd,
        type: 'prompt_retry_loop',
        severity: severityFromRatio(topHashCount / promptRetryCount),
        evidence: { textHash: topHash, count: topHashCount, threshold: promptRetryCount },
      });
    }
    if (s.maxToolStreak.count >= toolLoopCount) {
      anomalies.push({
        sessionId: s.sessionId,
        tool: s.tool,
        projectCwd: s.projectCwd,
        type: 'tool_loop',
        severity: severityFromRatio(s.maxToolStreak.count / toolLoopCount),
        evidence: {
          tool: s.maxToolStreak.name,
          consecutive: s.maxToolStreak.count,
          threshold: toolLoopCount,
        },
      });
    }
    // zombie gap
    let maxGapMin = 0;
    for (let i = 1; i < s.turnTs.length; i++) {
      const a = Date.parse(s.turnTs[i - 1]!);
      const b = Date.parse(s.turnTs[i]!);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const gap = (b - a) / 60_000;
        if (gap > maxGapMin) maxGapMin = gap;
      }
    }
    if (maxGapMin >= zombieGapMinutes) {
      anomalies.push({
        sessionId: s.sessionId,
        tool: s.tool,
        projectCwd: s.projectCwd,
        type: 'zombie_session',
        severity: severityFromRatio(maxGapMin / zombieGapMinutes),
        evidence: {
          maxGapMinutes: Math.round(maxGapMin),
          threshold: zombieGapMinutes,
        },
      });
    }
  }

  return anomalies;
}
