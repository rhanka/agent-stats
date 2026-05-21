import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { runAnomalies } from './anomalies.js';

describe('runAnomalies', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let codexDbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-anomalies-'));
    // Build a synthetic Claude session jsonl with many compactions and a
    // tool loop so we exercise multiple anomaly types.
    claudeProjectsDir = path.join(tmpDir, 'claude-projects');
    const projDir = path.join(claudeProjectsDir, '-h-u-p');
    mkdirSync(projDir, { recursive: true });
    const lines: string[] = [];
    // user prompt (single hash, no retry)
    lines.push(
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-18T10:00:00.000Z',
        sessionId: 's-flagged',
        cwd: '/h/u/p',
        message: { role: 'user', content: 'do many bash calls' },
      }),
    );
    // 12 consecutive Bash tool_use calls in one assistant message
    const toolUses = [];
    for (let i = 0; i < 12; i++) {
      toolUses.push({
        type: 'tool_use',
        id: `tu_${i}`,
        name: 'Bash',
        input: { command: 'ls' },
      });
    }
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-18T10:00:01.000Z',
        sessionId: 's-flagged',
        cwd: '/h/u/p',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: toolUses,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    );
    writeFileSync(path.join(projDir, 's-flagged.jsonl'), lines.join('\n') + '\n');

    // Codex DB with a session that has many compactions
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
    const rolloutPath = path.join(tmpDir, 'rollout.jsonl');
    const rolloutLines: string[] = [];
    rolloutLines.push(
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T11:00:00.000Z',
        payload: {
          id: 'c-flagged',
          timestamp: '2026-05-18T11:00:00.000Z',
          cwd: '/h/u/p',
          cli_version: '0.130.0',
          thread_source: 'primary',
          model_provider: 'openai',
        },
      }),
    );
    for (let i = 0; i < 15; i++) {
      rolloutLines.push(
        JSON.stringify({
          type: 'event_msg',
          timestamp: `2026-05-18T11:00:${i.toString().padStart(2, '0')}.000Z`,
          payload: { type: 'context_compacted' },
        }),
      );
    }
    writeFileSync(rolloutPath, rolloutLines.join('\n') + '\n');
    const ts = Math.floor(new Date('2026-05-18T10:59:00Z').getTime() / 1000);
    db.prepare(
      `INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, tokens_used, thread_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('c-flagged', rolloutPath, ts, ts + 60, '/h/u/p', 1000, 'primary');
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects anomalies from both sources', async () => {
    const r = await runAnomalies({ claudeProjectsDir, codexDbPath });
    const types = new Set(r.anomalies.map((a) => a.type));
    expect(types.has('tool_loop')).toBe(true); // from Claude session
    expect(types.has('runaway_compactions')).toBe(true); // from Codex session
  });

  it('outputs a table when format=table', async () => {
    const r = await runAnomalies({ claudeProjectsDir, codexDbPath, format: 'table' });
    expect(r.output).toMatch(/type/);
    expect(r.output).toMatch(/sev/);
  });

  it('sorts by severity descending', async () => {
    const r = await runAnomalies({ claudeProjectsDir, codexDbPath });
    const sevRank = { high: 3, medium: 2, low: 1 } as const;
    let prev = 4;
    for (const a of r.anomalies) {
      expect(sevRank[a.severity]).toBeLessThanOrEqual(prev);
      prev = sevRank[a.severity];
    }
  });
});
