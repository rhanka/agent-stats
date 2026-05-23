import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { runAnalyze } from './analyze.js';
import type { LlmMeshLike } from '@sentropic/agent-stats-core';

const coreFixtures = path.resolve(
  // packages/cli/src/commands/* -> packages/core/tests/fixtures
  process.cwd(),
  'packages/core/tests/fixtures',
);

describe('runAnalyze', () => {
  let tmpDir: string;
  let claudeProjectsDir: string;
  let codexDbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-analyze-'));
    claudeProjectsDir = path.join(tmpDir, 'claude-projects');
    const projDir = path.join(claudeProjectsDir, '-h-u-p');
    mkdirSync(projDir, { recursive: true });
    copyFileSync(
      path.join(coreFixtures, 'claude/sample-session.jsonl'),
      path.join(projDir, 'test-session-001.jsonl'),
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
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses to run without an injected mesh and without llm-mesh installed', async () => {
    await expect(runAnalyze({ claudeProjectsDir, codexDbPath })).rejects.toThrow(
      /llm-mesh is not available/,
    );
  });

  it('runs analyzeWithLlm for the top-N sessions using the injected mesh', async () => {
    const mesh: LlmMeshLike = {
      generate: vi.fn(async () => ({
        message: {
          content: JSON.stringify({
            frustrationLevel: 4,
            outOfControlScore: 2,
            summary: 'mock verdict',
            rootCauses: ['few tool calls'],
          }),
        },
      })),
    };
    const result = await runAnalyze({
      claudeProjectsDir,
      codexDbPath,
      mesh,
      limit: 5,
      model: 'mistral-small-4',
    });
    expect(result.verdicts.length).toBeGreaterThan(0);
    for (const v of result.verdicts) {
      expect(v.model).toBe('mistral-small-4');
      expect(v.summary).toBe('mock verdict');
    }
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
