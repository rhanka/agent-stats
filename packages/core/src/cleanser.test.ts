import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { cleanFile } from './cleanser.js';
import { buildSecretFixture } from '../tests/helpers/fake-secrets.js';

describe('cleanFile', () => {
  let tmpDir: string;
  let workFile: string;
  let tokens: { github: string; slack: string; anthropic: string };

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-clean-'));
    workFile = path.join(tmpDir, 'session.jsonl');
    const fixture = buildSecretFixture();
    writeFileSync(workFile, fixture.jsonl);
    tokens = fixture.tokens;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archive mode: writes redacted copy and leaves the source untouched', async () => {
    const outPath = path.join(tmpDir, 'archive', 'session.jsonl');
    const stats = await cleanFile({
      filePath: workFile,
      mode: 'archive',
      outputPath: outPath,
    });
    expect(stats.secretsFound).toBeGreaterThan(0);
    expect(existsSync(outPath)).toBe(true);
    const out = readFileSync(outPath, 'utf8');
    expect(out).not.toContain(tokens.github);
    expect(out).not.toContain(tokens.slack);
    expect(out).not.toContain(tokens.anthropic);
    expect(out).toMatch(/<<SECRET:/);
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('inplace mode: rewrites the source, writes a .bak with the original', async () => {
    const original = readFileSync(workFile, 'utf8');
    const stats = await cleanFile({ filePath: workFile, mode: 'inplace' });
    expect(stats.outputPath).toBe(workFile);
    expect(stats.secretsFound).toBeGreaterThan(0);
    const bak = readFileSync(`${workFile}.bak`, 'utf8');
    expect(bak).toBe(original);
    const after = readFileSync(workFile, 'utf8');
    expect(after).not.toContain(tokens.github);
    expect(after).toMatch(/<<SECRET:/);
  });

  it('llm-input mode: truncates large strings even without secrets', async () => {
    const bigPayload = 'A'.repeat(5000);
    const line = {
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      sessionId: 'big',
      cwd: '/x',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: bigPayload }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    writeFileSync(workFile, `${JSON.stringify(line)}\n`);
    const outPath = path.join(tmpDir, 'llm', 'session.jsonl');
    const stats = await cleanFile({
      filePath: workFile,
      mode: 'llm-input',
      outputPath: outPath,
      maxToolResultBytes: 200,
      skipSecrets: true,
    });
    expect(stats.truncations).toBe(1);
    const out = readFileSync(outPath, 'utf8');
    expect(out.length).toBeLessThan(bigPayload.length);
    expect(out).toContain('bytes truncated by agent-stats clean');
  });

  it('refuses archive mode without outputPath', async () => {
    await expect(cleanFile({ filePath: workFile, mode: 'archive' })).rejects.toThrow(
      /--output is required/,
    );
  });

  it('redaction tags include the rule id and a stable hash', async () => {
    const outPath = path.join(tmpDir, 'archive2', 'session.jsonl');
    await cleanFile({ filePath: workFile, mode: 'archive', outputPath: outPath });
    const out = readFileSync(outPath, 'utf8');
    expect(out).toMatch(/<<SECRET:[a-zA-Z0-9_-]+:[0-9a-f]{16}>>/);
  });
});
