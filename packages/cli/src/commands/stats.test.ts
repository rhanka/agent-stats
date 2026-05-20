import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { runStats } from './stats.js';

const coreFixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../core/tests/fixtures',
);

describe('runStats', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let codexDbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-cli-'));
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

  it('returns JSON by default with aggregated rows', async () => {
    const { output, rows } = await runStats({ claudeProjectsDir, codexDbPath });
    expect(rows.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(rows.length);
  });

  it('outputs a table when format=table', async () => {
    const { output } = await runStats({ claudeProjectsDir, codexDbPath, format: 'table' });
    expect(output).toMatch(/week/);
    expect(output).toMatch(/cost/);
  });

  it('respects the tool filter', async () => {
    const { rows } = await runStats({ claudeProjectsDir, codexDbPath, tool: 'claude' });
    expect(rows.every((r) => r.tool === 'claude')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('rejects an invalid --since', async () => {
    await expect(runStats({ claudeProjectsDir, codexDbPath, since: 'not-a-date' })).rejects.toThrow(
      /Invalid --since/,
    );
  });
});
