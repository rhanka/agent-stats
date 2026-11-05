import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { runVerify } from './verify.js';

function fakeValue(seed: string, len: number): string {
  const alpha = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  let out = seed;
  for (let i = 0; out.length < len; i++) out += alpha[(i * 7 + seed.length) % alpha.length];
  return out.slice(0, len);
}

describe('runVerify', () => {
  let tmpDir: string;
  let envFile: string;
  let target: string;
  let value: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-verify-cli-'));
    envFile = path.join(tmpDir, 'secrets.env');
    target = path.join(tmpDir, 'session.jsonl');
    value = fakeValue('SYNTH-CLI-', 40);
    writeFileSync(envFile, `SYNTH_CLI=${value}\n`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should report leaked without printing the value', async () => {
    writeFileSync(target, `leaked ${value} here\n`);
    const r = await runVerify({ file: target, envFile, vars: ['SYNTH_CLI'] });
    expect(r.leaked).toBe(true);
    expect(r.totalHits).toBe(1);
    expect(r.output).toContain('SYNTH_CLI');
    expect(r.output).not.toContain(value);
  });

  it('should report clean when the value is absent', async () => {
    writeFileSync(target, 'clean transcript\n');
    const r = await runVerify({ file: target, envFile, vars: ['SYNTH_CLI'] });
    expect(r.leaked).toBe(false);
    expect(r.output).toContain('result: clean');
  });

  it('should require at least one var name', async () => {
    writeFileSync(target, 'x\n');
    await expect(runVerify({ file: target, envFile, vars: [] })).rejects.toThrow(/VAR name/);
  });
});
