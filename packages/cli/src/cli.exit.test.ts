import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const cliPath = path.join(repoRoot, 'packages/cli/dist/cli.js');

/** Rebuild only when dist is missing or older than the sources it embeds. */
function distIsStale(): boolean {
  const stale = (built: string, src: string): boolean => {
    if (!existsSync(built) || !existsSync(src)) return true;
    return statSync(built).mtimeMs < statSync(src).mtimeMs;
  };
  const coreDist = path.join(repoRoot, 'packages/core/dist/index.js');
  return (
    stale(cliPath, path.join(here, 'cli.ts')) ||
    stale(coreDist, path.join(repoRoot, 'packages/core/src/verify.ts')) ||
    stale(coreDist, path.join(repoRoot, 'packages/core/src/cleanser.ts'))
  );
}

function fakeValue(seed: string, len: number): string {
  const alpha = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  let out = seed;
  for (let i = 0; out.length < len; i++) out += alpha[(i * 7 + seed.length) % alpha.length];
  return out.slice(0, len);
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout as string, stderr: r.stderr as string };
}

describe('cli verify exit code', () => {
  let tmpDir = '';

  beforeAll(() => {
    if (!distIsStale()) return;
    const build = spawnSync(
      'npm',
      ['run', 'build', '--workspace', 'packages/core', '--workspace', 'packages/cli'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 180000 },
    );
    if (build.status !== 0) {
      throw new Error(`cli exit test setup: build failed\n${build.stdout}\n${build.stderr}`);
    }
  }, 180000);

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when a value leaked and 0 when clean', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-cli-exit-'));
    const value = fakeValue('SYNTH-EXIT-', 40);
    const envFile = path.join(tmpDir, 'secrets.env');
    const leakedFile = path.join(tmpDir, 'leaked.jsonl');
    const cleanFile = path.join(tmpDir, 'clean.jsonl');
    writeFileSync(envFile, `SYNTH_EXIT=${value}\n`);
    writeFileSync(leakedFile, `prefix ${value} suffix\n`);
    writeFileSync(cleanFile, 'nothing sensitive here\n');

    const leaked = runCli(['verify', '--file', leakedFile, '--env-file', envFile, 'SYNTH_EXIT']);
    expect(leaked.status).toBe(1);
    expect(leaked.stdout).toContain('SYNTH_EXIT');
    expect(leaked.stdout).not.toContain(value);

    const clean = runCli(['verify', '--file', cleanFile, '--env-file', envFile, 'SYNTH_EXIT']);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('result: clean');
    expect(clean.stdout).not.toContain(value);
  }, 180000);
});
