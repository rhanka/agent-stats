/**
 * `agent-stats analyze` — qualitative LLM analysis of session aggregates.
 *
 * Requires a `@sentropic/llm-mesh` factory: the CLI dynamically imports
 * it and bails out with a friendly message if it isn't installed. This
 * keeps the rest of the CLI usable without llm-mesh as a hard dep.
 */

import {
  aggregateSessions,
  analyzeWithLlm,
  collect,
  type AnalysisVerdict,
  type CollectOptions,
  type LlmMeshLike,
} from '@sentropic/agent-stats-core';

export interface AnalyzeCommandOptions {
  since?: string;
  until?: string;
  tool?: 'claude' | 'codex' | 'cursor';
  project?: string;
  model?: string;
  limit?: number;
  /** Inject a mesh in tests; otherwise loaded dynamically. */
  mesh?: LlmMeshLike;
  claudeProjectsDir?: string;
  codexDbPath?: string;
  cursorStateDir?: string;
}

export interface AnalyzeResult {
  verdicts: AnalysisVerdict[];
  output: string;
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --${label} value: ${value} (expected ISO 8601)`);
  }
  return d;
}

/**
 * Best-effort dynamic loader for `@sentropic/llm-mesh`. Returns undefined
 * if the package isn't installed in the current workspace.
 */
async function loadMeshFromEnv(): Promise<LlmMeshLike | undefined> {
  try {
    // Dynamic import via an indirected specifier so TypeScript does not
    // try to resolve `@sentropic/llm-mesh` at type-check time (the dep is
    // optional). Wrappers can always inject their own mesh via `opts.mesh`.
    const meshPkg: string = '@sentropic/llm-mesh';
    const mod = (await import(/* @vite-ignore */ meshPkg)) as unknown as {
      createLlmMesh?: (opts: unknown) => LlmMeshLike;
    };
    if (typeof mod.createLlmMesh !== 'function') return undefined;
    // Default mesh wiring is left to the caller — we have no provider config
    // here. Users with their own llm-mesh config should import the lib in a
    // small wrapper script and pass the resulting mesh via runAnalyze({mesh}).
    return undefined;
  } catch {
    return undefined;
  }
}

export async function runAnalyze(opts: AnalyzeCommandOptions = {}): Promise<AnalyzeResult> {
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
  const mesh = opts.mesh ?? (await loadMeshFromEnv());
  if (!mesh) {
    throw new Error(
      '@sentropic/llm-mesh is not available. Install it as a dependency or wrap the lib programmatically (runAnalyze accepts { mesh }).',
    );
  }
  const model = opts.model ?? 'mistral-small-4';
  const sessions = await aggregateSessions(collect(collectOpts));
  const limit = opts.limit ?? 10;
  const top = [...sessions]
    .sort((a, b) => b.toolCalls + b.compactions * 2 - (a.toolCalls + a.compactions * 2))
    .slice(0, limit);
  const verdicts: AnalysisVerdict[] = [];
  for (const s of top) {
    const v = await analyzeWithLlm(s, { mesh, model });
    verdicts.push(v);
  }
  return { verdicts, output: JSON.stringify(verdicts, null, 2) };
}
