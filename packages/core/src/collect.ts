/**
 * `collect()` is the public entry point that merges the Claude Code and
 * Codex CLI parsers into a single async iterator of normalized events,
 * filtered by tool / project / time window.
 *
 * Discovery rules:
 *  - Claude sessions: scan `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl`.
 *    The directory name encodes the cwd by replacing `/` with `-` and
 *    prepending a leading dash (e.g. `/home/u/src/demo` ↔
 *    `-home-u-src-demo`). The project filter is applied on the decoded cwd.
 *  - Codex sessions: query `~/.codex/state_5.sqlite` via `indexCodexSessions`,
 *    then stream each matching rollout.
 *
 * Time filtering is applied at the file level when possible (mtime / DB
 * created_at), then enforced per-event using the event `ts`.
 */

import { promises as fs, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';

import type { SessionEvent } from './schema.js';
import { parseClaudeSession } from './parsers/claude.js';
import { indexCodexSessions, parseCodexRollout, type IndexCodexOptions } from './parsers/codex.js';

export interface CollectOptions {
  sources?: { claude?: boolean; codex?: boolean };
  since?: Date;
  until?: Date;
  /**
   * Exact cwd OR cwd prefix when ending with `/`. Applied to BOTH Claude
   * and Codex sources.
   */
  projectCwd?: string;
  /** Override path for ~/.claude/projects/ */
  claudeProjectsDir?: string;
  /** Override path for the Codex sqlite index. */
  codexDbPath?: string;
}

const DEFAULT_HOME = (): string => process.env['HOME'] ?? '';

/** Decode a Claude project dir name back to its absolute cwd. */
export function decodeClaudeProjectDir(name: string): string {
  // `-home-u-src-demo` → `/home/u/src/demo`
  return name.startsWith('-') ? name.replace(/-/g, '/') : name;
}

function matchesProjectCwd(cwd: string, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter.endsWith('/')) return cwd.startsWith(filter);
  return cwd === filter;
}

function eventInWindow(ev: SessionEvent, since?: Date, until?: Date): boolean {
  const t = Date.parse(ev.ts);
  if (Number.isNaN(t)) return true; // keep events without ts
  if (since && t < since.getTime()) return false;
  if (until && t > until.getTime()) return false;
  return true;
}

async function* collectClaude(opts: CollectOptions): AsyncGenerator<SessionEvent, void, unknown> {
  const projectsDir = opts.claudeProjectsDir ?? path.join(DEFAULT_HOME(), '.claude', 'projects');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const decoded = decodeClaudeProjectDir(entry.name);
    if (!matchesProjectCwd(decoded, opts.projectCwd)) continue;
    const dir = path.join(projectsDir, entry.name);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, f);
      let stat: Stats;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }
      if (opts.since && stat.mtime < opts.since) continue;
      // upper bound on mtime is permissive (a file might still be open).
      for await (const ev of parseClaudeSession({ filePath })) {
        if (!eventInWindow(ev, opts.since, opts.until)) continue;
        yield ev;
      }
    }
  }
}

async function* collectCodex(opts: CollectOptions): AsyncGenerator<SessionEvent, void, unknown> {
  const indexOpts: IndexCodexOptions = {};
  if (opts.codexDbPath !== undefined) indexOpts.dbPath = opts.codexDbPath;
  if (opts.since !== undefined) indexOpts.since = opts.since;
  if (opts.until !== undefined) indexOpts.until = opts.until;
  if (opts.projectCwd !== undefined) indexOpts.projectCwd = opts.projectCwd;
  let entries: ReturnType<typeof indexCodexSessions>;
  try {
    entries = indexCodexSessions(indexOpts);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!matchesProjectCwd(e.cwd, opts.projectCwd)) continue;
    try {
      await fs.access(e.rolloutPath);
    } catch {
      continue;
    }
    for await (const ev of parseCodexRollout({
      filePath: e.rolloutPath,
      sessionId: e.id,
      projectCwd: e.cwd,
    })) {
      if (!eventInWindow(ev, opts.since, opts.until)) continue;
      yield ev;
    }
  }
}

/**
 * Yield events from one or both sources, optionally filtered by project /
 * time window. The order across sources is NOT guaranteed; callers that
 * need a global timeline should sort by `ts` after collecting.
 */
export async function* collect(
  opts: CollectOptions = {},
): AsyncGenerator<SessionEvent, void, unknown> {
  const sources = { claude: true, codex: true, ...(opts.sources ?? {}) };
  if (sources.claude) {
    yield* collectClaude(opts);
  }
  if (sources.codex) {
    yield* collectCodex(opts);
  }
}
