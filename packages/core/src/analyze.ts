/**
 * `analyzeWithLlm(session, opts)` — qualitative analysis of a session.
 *
 * Phase 2 (LLM-driven) is intentionally pluggable: callers inject the
 * `mesh` (an `LlmMesh` instance from `@sentropic/llm-mesh`) and the
 * `model` id. The core lib does not import `@sentropic/llm-mesh`
 * directly so that consumers without a mesh can still use the rest of
 * the library; the type is duck-typed below.
 *
 * Outputs a JSON verdict (`AnalysisVerdict`) with `frustration_level`
 * and `out_of_control_score` (0-10), a short summary, and an optional
 * list of root causes.
 */

import { createHash } from 'node:crypto';
import type { SessionAggregate } from './aggregations.js';

export interface AnalysisVerdict {
  sessionId: string;
  model: string;
  frustrationLevel: number; // 0..10
  outOfControlScore: number; // 0..10
  summary: string;
  rootCauses: string[];
}

/**
 * Duck-typed subset of `LlmMesh` from `@sentropic/llm-mesh`. We don't
 * import the real type so the core stays decoupled.
 */
export interface LlmMeshLike {
  generate(request: {
    model: string | { providerId: string; modelId: string };
    messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    providerId?: string;
    [k: string]: unknown;
  }): Promise<{ message?: { content?: string }; text?: string; [k: string]: unknown }>;
}

export interface AnalyzeOptions {
  mesh: LlmMeshLike;
  /** Model id passed verbatim to the mesh `generate` call. */
  model: string;
  /** Optional storage adapter used for verdict cache. */
  cache?: AnalyzeCache;
}

export interface AnalyzeCache {
  read(key: string): Promise<AnalysisVerdict | null>;
  write(key: string, verdict: AnalysisVerdict): Promise<void>;
}

const PROMPT = `You are an analyst grading a coding-agent session.
Read the JSON aggregate below and return a JSON verdict with EXACTLY this shape:
{
  "frustrationLevel": <integer 0..10>,
  "outOfControlScore": <integer 0..10>,
  "summary": "<one sentence>",
  "rootCauses": ["<short cause>", ...]
}
Frustration: estimate user frustration from retries, compactions, error rates.
Out-of-control: estimate AI loops, runaway sessions, tool flailing.
Return ONLY the JSON, no prose, no markdown fence.`;

function sessionFingerprint(session: SessionAggregate): string {
  const payload = JSON.stringify({
    id: session.sessionId,
    turns: session.turns,
    tools: session.toolCalls,
    cat: session.toolCallsByCategory,
    comp: session.compactions,
    cost: session.estimatedCost,
    dur: session.durationMs,
    rl: session.rateLimitMax,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function extractJson(text: string): unknown {
  // The mesh sometimes wraps output in ```json ... ```; strip it.
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

function clampScore(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function buildPayload(session: SessionAggregate): string {
  return JSON.stringify(
    {
      sessionId: session.sessionId,
      tool: session.tool,
      model: session.model,
      durationMs: session.durationMs,
      turns: session.turns,
      isSubagent: session.isSubagent,
      forkedFromId: session.forkedFromId ?? null,
      toolCalls: session.toolCalls,
      toolCallsByCategory: session.toolCallsByCategory,
      compactions: session.compactions,
      estimatedCost: session.estimatedCost,
      rateLimitMax: session.rateLimitMax ?? null,
      totalInputTokens:
        session.totalUsage.newInputTokens +
        session.totalUsage.cachedInputTokens +
        session.totalUsage.cacheWriteTokens,
      outputTokens: session.totalUsage.outputTokens,
      reasoningTokens: session.totalUsage.reasoningTokens,
    },
    null,
    2,
  );
}

/**
 * Run the LLM analysis for a single session. Returns the verdict.
 * On cache hit, the mesh is not called.
 */
export async function analyzeWithLlm(
  session: SessionAggregate,
  opts: AnalyzeOptions,
): Promise<AnalysisVerdict> {
  const key = `${session.sessionId}|${opts.model}|${sessionFingerprint(session)}`;
  if (opts.cache) {
    const cached = await opts.cache.read(key);
    if (cached) return cached;
  }
  const payload = buildPayload(session);
  const result = await opts.mesh.generate({
    model: opts.model,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: payload },
    ],
  });
  const text = result.message?.content ?? result.text ?? '';
  if (!text) throw new Error('analyzeWithLlm: mesh returned empty response');
  const parsed = extractJson(text) as Record<string, unknown>;
  const verdict: AnalysisVerdict = {
    sessionId: session.sessionId,
    model: opts.model,
    frustrationLevel: clampScore(parsed['frustrationLevel']),
    outOfControlScore: clampScore(parsed['outOfControlScore']),
    summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : '',
    rootCauses: Array.isArray(parsed['rootCauses'])
      ? (parsed['rootCauses'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
  };
  if (opts.cache) await opts.cache.write(key, verdict);
  return verdict;
}

/**
 * Compare `n` LLM models on the same set of sessions and return per-model
 * latency, predicted-vs-baseline alignment, and aggregate cost (best-effort).
 *
 * `baseline` is the heuristic verdict (or hand-labeled if available); it
 * provides a reference frustration & out-of-control score per session.
 */
export interface BenchModelConfig {
  model: string;
  mesh: LlmMeshLike;
}

export interface BenchSampleBaseline {
  sessionId: string;
  frustrationLevel: number;
  outOfControlScore: number;
}

export interface BenchModelResult {
  model: string;
  samples: number;
  durationMs: number;
  /** Mean absolute error vs baseline scores (combined, normalized 0..10). */
  meanAbsoluteError: number;
  errors: string[];
}

export interface BenchOptions {
  models: BenchModelConfig[];
  sessions: SessionAggregate[];
  baselines: BenchSampleBaseline[];
}

export async function benchModels(opts: BenchOptions): Promise<BenchModelResult[]> {
  const baselineById = new Map(opts.baselines.map((b) => [b.sessionId, b] as const));
  const results: BenchModelResult[] = [];
  for (const cfg of opts.models) {
    const errors: string[] = [];
    let mae = 0;
    let counted = 0;
    const t0 = Date.now();
    for (const s of opts.sessions) {
      const base = baselineById.get(s.sessionId);
      try {
        const v = await analyzeWithLlm(s, { mesh: cfg.mesh, model: cfg.model });
        if (base) {
          const e =
            (Math.abs(v.frustrationLevel - base.frustrationLevel) +
              Math.abs(v.outOfControlScore - base.outOfControlScore)) /
            2;
          mae += e;
          counted += 1;
        }
      } catch (e) {
        errors.push(`${s.sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    results.push({
      model: cfg.model,
      samples: counted,
      durationMs: Date.now() - t0,
      meanAbsoluteError: counted ? mae / counted : 0,
      errors,
    });
  }
  return results;
}
