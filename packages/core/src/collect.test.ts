import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { collect, decodeClaudeProjectDir } from './collect.js';
import type { SessionEvent } from './schema.js';

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures',
);

describe('decodeClaudeProjectDir', () => {
  it('decodes Claude project directory encoding', () => {
    expect(decodeClaudeProjectDir('-home-u-src-demo')).toBe('/home/u/src/demo');
    expect(decodeClaudeProjectDir('plain-name')).toBe('plain-name');
  });
});

describe('collect() integration', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let codexDbPath: string;
  let codexRolloutPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-collect-'));

    // Claude: prepare ~/.claude/projects/-home-u-src-demo/<sid>.jsonl
    claudeProjectsDir = path.join(tmpDir, 'claude-projects');
    const projDir = path.join(claudeProjectsDir, '-home-u-src-demo');
    mkdirSync(projDir, { recursive: true });
    copyFileSync(
      path.join(fixturesRoot, 'claude/sample-session.jsonl'),
      path.join(projDir, 'test-session-001.jsonl'),
    );

    // Codex: prepare a minimal state_5.sqlite that points to the fixture rollout.
    codexRolloutPath = path.join(fixturesRoot, 'codex/sample-rollout.jsonl');
    codexDbPath = path.join(tmpDir, 'state_5.sqlite');
    const db = new Database(codexDbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        thread_source TEXT
      );
    `);
    const ts = Math.floor(new Date('2026-05-18T09:59:00Z').getTime() / 1000);
    db.prepare(
      `INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, tokens_used, thread_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '019e0000-1111-2222-3333-444444444444',
      codexRolloutPath,
      ts,
      ts + 60,
      '/home/u/src/demo',
      2100,
      'primary',
    );
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function gather(opts: Parameters<typeof collect>[0]): Promise<SessionEvent[]> {
    const out: SessionEvent[] = [];
    for await (const ev of collect(opts)) out.push(ev);
    return out;
  }

  it('streams events from both sources by default', async () => {
    const events = await gather({ claudeProjectsDir, codexDbPath });
    const tools = new Set(events.map((e) => e.tool));
    expect(tools.has('claude')).toBe(true);
    expect(tools.has('codex')).toBe(true);
  });

  it('honors the claude-only source filter', async () => {
    const events = await gather({
      claudeProjectsDir,
      codexDbPath,
      sources: { claude: true, codex: false },
    });
    expect(events.every((e) => e.tool === 'claude')).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('honors the codex-only source filter', async () => {
    const events = await gather({
      claudeProjectsDir,
      codexDbPath,
      sources: { claude: false, codex: true },
    });
    expect(events.every((e) => e.tool === 'codex')).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('filters by exact projectCwd', async () => {
    const events = await gather({
      claudeProjectsDir,
      codexDbPath,
      projectCwd: '/home/u/src/demo',
    });
    expect(events.every((e) => e.projectCwd === '/home/u/src/demo')).toBe(true);
  });

  it('drops events outside the [since, until] window', async () => {
    // Both fixtures are stamped 2026-05-18; filter to a different day.
    const events = await gather({
      claudeProjectsDir,
      codexDbPath,
      since: new Date('2027-01-01'),
    });
    expect(events).toHaveLength(0);
  });

  it('still produces normalized session_start events from each source', async () => {
    const events = await gather({ claudeProjectsDir, codexDbPath });
    const starts = events.filter((e) => e.kind === 'session_start');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(starts.map((s) => s.tool))).toEqual(new Set(['claude', 'codex']));
  });
});
