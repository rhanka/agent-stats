import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { runReport } from './report.js';

const coreFixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../core/tests/fixtures',
);

describe('runReport', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let codexDbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-cli-report-'));
    claudeProjectsDir = path.join(tmpDir, 'claude-projects');
    const proj = path.join(claudeProjectsDir, '-home-u-src-demo');
    mkdirSync(proj, { recursive: true });
    copyFileSync(
      path.join(coreFixtures, 'claude/sample-session.jsonl'),
      path.join(proj, 'test-session-001.jsonl'),
    );
    codexDbPath = path.join(tmpDir, 'state_5.sqlite');
    const db = new Database(codexDbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0,
        model TEXT, thread_source TEXT
      );
    `);
    const ts = Math.floor(new Date('2026-05-18T09:59:00Z').getTime() / 1000);
    db.prepare(
      `INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, tokens_used, thread_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '019e0000-1111-2222-3333-444444444444',
      path.join(coreFixtures, 'codex/sample-rollout.jsonl'),
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

  it('renders Markdown with a Totals section per week', async () => {
    const { output, rows } = await runReport({ claudeProjectsDir, codexDbPath });
    expect(rows.length).toBeGreaterThan(0);
    expect(output).toContain('# agent-stats — weekly report');
    expect(output).toContain('## Week 2026-05-18');
    expect(output).toContain('### Totals');
    expect(output).toContain('### Top projects');
    expect(output).toContain('### Top models');
  });

  it('honors --top to limit Top-N tables', async () => {
    const { output } = await runReport({ claudeProjectsDir, codexDbPath, top: 1 });
    // Should still contain headers.
    expect(output).toContain('### Top projects');
  });

  it('reports "no data" when nothing matches', async () => {
    const { output } = await runReport({
      claudeProjectsDir,
      codexDbPath,
      since: '2030-01-01',
    });
    expect(output).toContain('Period: no data');
  });
});
