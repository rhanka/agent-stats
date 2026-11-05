import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { verifyFile } from './verify.js';

// Values are assembled at runtime from fake fragments so the repo never
// contains a committable secret-shaped literal — including in fixtures.

function fakeValue(seed: string, len: number): string {
  const alpha = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  let out = seed;
  for (let i = 0; out.length < len; i++) out += alpha[(i * 7 + seed.length) % alpha.length];
  return out.slice(0, len);
}

describe('verifyFile', () => {
  let tmpDir: string;
  let envFile: string;
  let target: string;
  let valueA: string;
  let valueB: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-verify-'));
    envFile = path.join(tmpDir, 'secrets.env');
    target = path.join(tmpDir, 'session.jsonl');
    valueA = fakeValue('SYNTH-VERIFY-A-', 48);
    valueB = fakeValue('SYNTH-VERIFY-B-', 48);
    writeFileSync(envFile, `SYNTH_A=${valueA}\nSYNTH_B=${valueB}\n`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should count raw and base64 occurrences without printing values', async () => {
    const blob = Buffer.from(valueA, 'utf8').toString('base64');
    writeFileSync(target, `line one ${valueA} tail\nsecond ${blob} end\nplain text\n`);
    const r = await verifyFile({ filePath: target, envFilePath: envFile, varNames: ['SYNTH_A'] });
    expect(r.leaked).toBe(true);
    expect(r.totalHits).toBe(2);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ name: 'SYNTH_A', rawCount: 1, base64Count: 1, count: 2 });
    expect(r.entries[0]!.sha256).toBe(
      createHash('sha256').update(valueA, 'utf8').digest('hex').slice(0, 16),
    );
    // Names, counts and fingerprints only — never the value or its encoding.
    expect(r.output).toContain('SYNTH_A');
    expect(r.output).toContain('count=2');
    expect(r.output).not.toContain(valueA);
    expect(r.output).not.toContain(blob);
  });

  it('should report clean with zero counts when nothing leaked', async () => {
    writeFileSync(target, 'nothing sensitive here\n');
    const r = await verifyFile({
      filePath: target,
      envFilePath: envFile,
      varNames: ['SYNTH_A', 'SYNTH_B'],
    });
    expect(r.leaked).toBe(false);
    expect(r.totalHits).toBe(0);
    expect(r.entries.map((e) => e.count)).toEqual([0, 0]);
    expect(r.output).toContain('result: clean');
  });

  it('should fail closed on unknown vars without echoing argv', async () => {
    writeFileSync(target, 'x\n');
    await expect(
      verifyFile({ filePath: target, envFilePath: envFile, varNames: ['NOPE_MISSING'] }),
    ).rejects.toThrow(/unknown var at index 0/);
    // The rejection carries the index only; names and values stay out.
    try {
      await verifyFile({ filePath: target, envFilePath: envFile, varNames: ['NOPE_MISSING'] });
      expect.unreachable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('NOPE_MISSING');
      expect(msg).not.toContain(valueA);
      expect(msg).not.toContain(valueB);
    }
  });

  it('should not echo a pasted value in the invalid-name error', async () => {
    writeFileSync(target, 'x\n');
    const pasted = fakeValue('SYNTH-PASTED-', 40);
    await expect(
      verifyFile({ filePath: target, envFilePath: envFile, varNames: [pasted] }),
    ).rejects.toThrow(/invalid var name at index 0/);
    try {
      await verifyFile({ filePath: target, envFilePath: envFile, varNames: [pasted] });
      expect.unreachable();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(pasted);
      expect(msg).not.toContain(valueA);
    }
  });

  it('should fail closed on empty values', async () => {
    writeFileSync(envFile, 'SYNTH_EMPTY=\n');
    writeFileSync(target, 'x\n');
    await expect(
      verifyFile({ filePath: target, envFilePath: envFile, varNames: ['SYNTH_EMPTY'] }),
    ).rejects.toThrow(/empty value/);
  });

  it('should require at least one var name', async () => {
    writeFileSync(target, 'x\n');
    await expect(
      verifyFile({ filePath: target, envFilePath: envFile, varNames: [] }),
    ).rejects.toThrow(/at least one var name/);
  });
});
