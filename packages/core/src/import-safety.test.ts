import { describe, expect, it, vi } from 'vitest';

describe('public import safety', () => {
  it('imports claude, collect, and schema without loading better-sqlite3', async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => {
      throw new Error('better-sqlite3 should only load when SQLite-backed parsers run');
    });

    await expect(import('./parsers/claude.js')).resolves.toHaveProperty('parseClaudeSession');
    await expect(import('./schema.js')).resolves.toHaveProperty('ZERO_USAGE');
    await expect(import('./collect.js')).resolves.toHaveProperty('collect');

    vi.doUnmock('better-sqlite3');
  });
});
