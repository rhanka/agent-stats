import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { runClean } from './clean.js';
import { buildSecretFixture } from '../../../core/tests/helpers/fake-secrets.js';

describe('runClean', () => {
  let tmpDir: string;
  let inputDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-clean-cli-'));
    inputDir = path.join(tmpDir, 'input', 'project-a');
    mkdirSync(inputDir, { recursive: true });
    const f = buildSecretFixture();
    writeFileSync(path.join(inputDir, 's1.jsonl'), f.jsonl);
    writeFileSync(path.join(inputDir, 's2.jsonl'), f.jsonl);
    outDir = path.join(tmpDir, 'out');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cleans every jsonl under a directory in archive mode', async () => {
    const r = await runClean({ input: inputDir, mode: 'archive', out: outDir });
    expect(r.totals.files).toBe(2);
    expect(r.totals.secretsFound).toBeGreaterThan(0);
    expect(existsSync(path.join(outDir, 's1.jsonl'))).toBe(true);
    expect(existsSync(path.join(outDir, 's2.jsonl'))).toBe(true);
    const out = readFileSync(path.join(outDir, 's1.jsonl'), 'utf8');
    expect(out).toMatch(/<<SECRET:/);
  });

  it('refuses archive/llm-input without --out', async () => {
    await expect(runClean({ input: inputDir, mode: 'archive' })).rejects.toThrow(
      /--out is required/,
    );
  });

  it('inplace mode rewrites and creates .bak files', async () => {
    const r = await runClean({ input: inputDir, mode: 'inplace' });
    expect(r.totals.files).toBe(2);
    expect(existsSync(path.join(inputDir, 's1.jsonl.bak'))).toBe(true);
    expect(existsSync(path.join(inputDir, 's2.jsonl.bak'))).toBe(true);
    const after = readFileSync(path.join(inputDir, 's1.jsonl'), 'utf8');
    expect(after).toMatch(/<<SECRET:/);
  });

  it('inplace with backup:false keeps no .bak beside cleaned files', async () => {
    const r = await runClean({ input: inputDir, mode: 'inplace', backup: false });
    expect(r.totals.files).toBe(2);
    expect(existsSync(path.join(inputDir, 's1.jsonl.bak'))).toBe(false);
    expect(existsSync(path.join(inputDir, 's2.jsonl.bak'))).toBe(false);
    const after = readFileSync(path.join(inputDir, 's1.jsonl'), 'utf8');
    expect(after).toMatch(/<<SECRET:/);
  });

  it('inplace with backupDir mirrors backups with mode 0600', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    const r = await runClean({ input: inputDir, mode: 'inplace', backupDir });
    expect(r.totals.files).toBe(2);
    expect(existsSync(path.join(inputDir, 's1.jsonl.bak'))).toBe(false);
    const bak1 = path.join(backupDir, 's1.jsonl.bak');
    const bak2 = path.join(backupDir, 's2.jsonl.bak');
    expect(existsSync(bak1)).toBe(true);
    expect(existsSync(bak2)).toBe(true);
    expect(statSync(bak1).mode & 0o777).toBe(0o600);
  });

  it('rejects backup flags outside inplace mode and in combination', async () => {
    await expect(
      runClean({ input: inputDir, mode: 'archive', out: outDir, backup: false }),
    ).rejects.toThrow(/only apply to --mode inplace/);
    await expect(
      runClean({ input: inputDir, mode: 'inplace', backup: false, backupDir: outDir }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it('accepts a single file as input', async () => {
    const file = path.join(inputDir, 's1.jsonl');
    const r = await runClean({ input: file, mode: 'archive', out: outDir });
    expect(r.totals.files).toBe(1);
    expect(existsSync(path.join(outDir, 's1.jsonl'))).toBe(true);
  });
});
