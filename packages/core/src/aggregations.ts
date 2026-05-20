/**
 * Weekly aggregations.
 *
 * Two-pass algorithm:
 *   1. Group events by `sessionId` and compute a `SessionMeta` per session
 *      (start ts, total usage, sub-agent depth, etc.).
 *   2. Bucket sessions by (weekStart × projectCwd × tool × model) and sum
 *      the metrics into `WeeklyAggregation` rows.
 *
 * Cost is split by currency: Codex credits and Claude USD cents are
 * tracked separately so they never get mixed.
 */

import { ZERO_USAGE, addUsage, type SessionEvent, type Tool, type Usage } from './schema.js';
import { DEFAULT_RATE_CARD, estimateCost, resolveRates, type ModelRates } from './rate-card.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionAggregate {
  sessionId: string;
  tool: Tool;
  projectCwd: string;
  model: string;
  startTs: string;
  endTs: string;
  durationMs: number;
  turns: number;
  totalUsage: Usage;
  isSubagent: boolean;
  forkedFromId?: string;
  toolCalls: number;
  toolCallsByCategory: Record<string, number>;
  toolCallsByName: Record<string, number>;
  skillInvocations: number;
  skillsByName: Record<string, number>;
  compactions: number;
  estimatedCost: { codexCredits: number; claudeUsdCents: number; unknown: number };
  rateLimitMax?: { primaryPercent: number; secondaryPercent: number };
}

export interface WeeklyAggregation {
  /** ISO date of the Monday opening the week (UTC). */
  weekStart: string;
  projectCwd: string;
  tool: Tool;
  model: string;
  sessions: number;
  subagentSessions: number;
  uniqueParents: number;
  totalDurationMs: number;
  turns: number;
  totalUsage: Usage;
  toolCalls: number;
  toolCallsByCategory: Record<string, number>;
  toolCallsByName: Record<string, number>;
  skillInvocations: number;
  skillsByName: Record<string, number>;
  compactions: number;
  estimatedCost: { codexCredits: number; claudeUsdCents: number; unknown: number };
  rateLimitMax?: { primaryPercent: number; secondaryPercent: number };
}

export interface AggregateOptions {
  /** Override the rate card; defaults to `DEFAULT_RATE_CARD`. */
  rateCard?: Record<string, ModelRates>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_COST = { codexCredits: 0, claudeUsdCents: 0, unknown: 0 };

function addCost(
  a: { codexCredits: number; claudeUsdCents: number; unknown: number },
  b: { codexCredits: number; claudeUsdCents: number; unknown: number },
): { codexCredits: number; claudeUsdCents: number; unknown: number } {
  return {
    codexCredits: a.codexCredits + b.codexCredits,
    claudeUsdCents: a.claudeUsdCents + b.claudeUsdCents,
    unknown: a.unknown + b.unknown,
  };
}

/** Monday 00:00 UTC of the ISO week containing `iso`. */
export function weekStartIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

function emptySessionAggregate(): SessionAggregate {
  return {
    sessionId: '',
    tool: 'claude',
    projectCwd: '',
    model: 'unknown',
    startTs: '',
    endTs: '',
    durationMs: 0,
    turns: 0,
    totalUsage: { ...ZERO_USAGE },
    isSubagent: false,
    toolCalls: 0,
    toolCallsByCategory: {},
    toolCallsByName: {},
    skillInvocations: 0,
    skillsByName: {},
    compactions: 0,
    estimatedCost: { ...ZERO_COST },
  };
}

// ---------------------------------------------------------------------------
// Pass 1: events → SessionAggregate[]
// ---------------------------------------------------------------------------

export async function aggregateSessions(
  events: AsyncIterable<SessionEvent> | Iterable<SessionEvent>,
  opts: AggregateOptions = {},
): Promise<SessionAggregate[]> {
  const card = opts.rateCard ?? DEFAULT_RATE_CARD;
  const map = new Map<string, SessionAggregate>();

  const ensure = (key: string, ev: SessionEvent): SessionAggregate => {
    let s = map.get(key);
    if (!s) {
      s = emptySessionAggregate();
      s.sessionId = ev.sessionId;
      s.tool = ev.tool;
      s.projectCwd = ev.projectCwd;
      s.startTs = ev.ts;
      s.endTs = ev.ts;
      map.set(key, s);
    }
    return s;
  };

  for await (const ev of events) {
    if (!ev.sessionId) continue;
    const s = ensure(ev.sessionId, ev);
    if (ev.ts && (!s.startTs || ev.ts < s.startTs)) s.startTs = ev.ts;
    if (ev.ts && (!s.endTs || ev.ts > s.endTs)) s.endTs = ev.ts;

    switch (ev.kind) {
      case 'session_start': {
        if (ev.model) s.model = ev.model;
        s.isSubagent = ev.isSubagent;
        if (ev.forkedFromId) s.forkedFromId = ev.forkedFromId;
        break;
      }
      case 'session_end':
        // ts already absorbed above.
        break;
      case 'turn': {
        s.turns += 1;
        if (ev.model && s.model === 'unknown') s.model = ev.model;
        s.totalUsage = addUsage(s.totalUsage, ev.usage);
        const rates = resolveRates(ev.model, card);
        const cost = estimateCost(ev.usage, rates);
        if (cost.currency === 'codex_credits') s.estimatedCost.codexCredits += cost.amount;
        else if (cost.currency === 'claude_usd_cents')
          s.estimatedCost.claudeUsdCents += cost.amount;
        else s.estimatedCost.unknown += cost.amount;
        if (ev.rateLimit) {
          const prev = s.rateLimitMax;
          const next = {
            primaryPercent: Math.max(prev?.primaryPercent ?? 0, ev.rateLimit.primaryPercent),
            secondaryPercent: Math.max(prev?.secondaryPercent ?? 0, ev.rateLimit.secondaryPercent),
          };
          s.rateLimitMax = next;
        }
        break;
      }
      case 'tool_call': {
        s.toolCalls += 1;
        s.toolCallsByCategory[ev.category] = (s.toolCallsByCategory[ev.category] ?? 0) + 1;
        s.toolCallsByName[ev.name] = (s.toolCallsByName[ev.name] ?? 0) + 1;
        break;
      }
      case 'skill_invoke': {
        s.skillInvocations += 1;
        s.skillsByName[ev.name] = (s.skillsByName[ev.name] ?? 0) + 1;
        break;
      }
      case 'compaction':
        s.compactions += 1;
        break;
      case 'user_prompt':
        // ts already absorbed; no other update for now.
        break;
    }
  }

  // duration
  for (const s of map.values()) {
    const start = Date.parse(s.startTs);
    const end = Date.parse(s.endTs);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      s.durationMs = Math.max(0, end - start);
    }
  }

  return [...map.values()].sort((a, b) => a.startTs.localeCompare(b.startTs));
}

// ---------------------------------------------------------------------------
// Pass 2: SessionAggregate[] → WeeklyAggregation[]
// ---------------------------------------------------------------------------

interface WeeklyAccumulator extends WeeklyAggregation {
  // Track unique parent thread ids for subagent count.
  parentIds: Set<string>;
}

function weeklyKey(weekStart: string, projectCwd: string, tool: Tool, model: string): string {
  return `${weekStart}|${projectCwd}|${tool}|${model}`;
}

function emptyWeekly(
  weekStart: string,
  projectCwd: string,
  tool: Tool,
  model: string,
): WeeklyAccumulator {
  return {
    weekStart,
    projectCwd,
    tool,
    model,
    sessions: 0,
    subagentSessions: 0,
    uniqueParents: 0,
    totalDurationMs: 0,
    turns: 0,
    totalUsage: { ...ZERO_USAGE },
    toolCalls: 0,
    toolCallsByCategory: {},
    toolCallsByName: {},
    skillInvocations: 0,
    skillsByName: {},
    compactions: 0,
    estimatedCost: { ...ZERO_COST },
    parentIds: new Set(),
  };
}

function mergeCounts(target: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Object.entries(src)) {
    target[k] = (target[k] ?? 0) + v;
  }
}

/** Roll SessionAggregates into weekly rows. */
export function bucketWeekly(sessions: SessionAggregate[]): WeeklyAggregation[] {
  const buckets = new Map<string, WeeklyAccumulator>();
  for (const s of sessions) {
    const week = weekStartIso(s.startTs);
    if (!week) continue;
    const key = weeklyKey(week, s.projectCwd, s.tool, s.model);
    let acc = buckets.get(key);
    if (!acc) {
      acc = emptyWeekly(week, s.projectCwd, s.tool, s.model);
      buckets.set(key, acc);
    }
    acc.sessions += 1;
    if (s.isSubagent) acc.subagentSessions += 1;
    if (s.forkedFromId) acc.parentIds.add(s.forkedFromId);
    acc.totalDurationMs += s.durationMs;
    acc.turns += s.turns;
    acc.totalUsage = addUsage(acc.totalUsage, s.totalUsage);
    mergeCounts(acc.toolCallsByCategory, s.toolCallsByCategory);
    mergeCounts(acc.toolCallsByName, s.toolCallsByName);
    acc.toolCalls += s.toolCalls;
    mergeCounts(acc.skillsByName, s.skillsByName);
    acc.skillInvocations += s.skillInvocations;
    acc.compactions += s.compactions;
    acc.estimatedCost = addCost(acc.estimatedCost, s.estimatedCost);
    if (s.rateLimitMax) {
      const prev = acc.rateLimitMax;
      acc.rateLimitMax = {
        primaryPercent: Math.max(prev?.primaryPercent ?? 0, s.rateLimitMax.primaryPercent),
        secondaryPercent: Math.max(prev?.secondaryPercent ?? 0, s.rateLimitMax.secondaryPercent),
      };
    }
  }
  return [...buckets.values()]
    .map((a) => {
      a.uniqueParents = a.parentIds.size;
      // strip the helper Set before returning.
      const { parentIds, ...rest } = a;
      void parentIds;
      return rest;
    })
    .sort(
      (a, b) =>
        a.weekStart.localeCompare(b.weekStart) ||
        a.projectCwd.localeCompare(b.projectCwd) ||
        a.tool.localeCompare(b.tool) ||
        a.model.localeCompare(b.model),
    );
}

/**
 * High-level helper: events → SessionAggregate[] → WeeklyAggregation[].
 * The caller does not need to know about the two passes.
 */
export async function aggregateWeekly(
  events: AsyncIterable<SessionEvent> | Iterable<SessionEvent>,
  opts: AggregateOptions = {},
): Promise<WeeklyAggregation[]> {
  const sessions = await aggregateSessions(events, opts);
  return bucketWeekly(sessions);
}

/** Cache-efficiency ratio (cached input tokens / total input tokens). */
export function cacheEfficiency(usage: Usage): number {
  const total = usage.newInputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  if (total === 0) return 0;
  return usage.cachedInputTokens / total;
}
