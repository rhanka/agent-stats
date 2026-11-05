import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const cliPath = path.join(repoRoot, 'packages/cli/dist/cli.js');

const requiredOutputs = [
  cliPath,
  path.join(here, '..', 'dist', 'commands', 'verify.js'),
  path.join(here, '..', 'dist', 'commands', 'web.js'),
  path.join(repoRoot, 'packages', 'core', 'dist', 'index.js'),
];

/**
 * Rebuild only when a required output is missing or older than the sources
 * it embeds. A stale `tsconfig.tsbuildinfo` can make `tsc` skip emit, so
 * existence of every required output is checked, not just `cli.js`.
 */
function distIsComplete(): boolean {
  let newestSrc = 0;
  for (const src of [
    path.join(here, 'cli.ts'),
    path.join(repoRoot, 'packages', 'core', 'src', 'verify.ts'),
    path.join(repoRoot, 'packages', 'core', 'src', 'cleanser.ts'),
  ]) {
    try {
      newestSrc = Math.max(newestSrc, statSync(src).mtimeMs);
    } catch {
      return false;
    }
  }
  return requiredOutputs.every((f) => {
    try {
      return existsSync(f) && statSync(f).mtimeMs >= newestSrc;
    } catch {
      return false;
    }
  });
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
    if (distIsComplete()) return;
    // Solution-style build: honors project references (unlike the plain
    // `tsc -p` workspace scripts). `--force` ignores incremental state:
    // `tsc -b` otherwise trusts `tsconfig.tsbuildinfo` and can skip emit
    // even when outputs are missing. `tsc` is spawned directly to avoid
    // npm cache issues.
    const tscBin = path.join(repoRoot, 'node_modules', '.bin', 'tsc');
    const build = spawnSync(process.execPath, [tscBin, '-b', '--force'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 180000,
    });
    if (build.status !== 0 || !distIsComplete()) {
      throw new Error(
        `cli exit test setup: build failed (status=${build.status})\n${build.stdout}\n${build.stderr}`,
      );
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
    expect(leaked.status, `leak run failed, stderr: ${leaked.stderr}`).toBe(1);
    expect(
      leaked.stdout,
      `leak run stdout empty, status: ${leaked.status}, stderr: ${leaked.stderr}`,
    ).toContain('SYNTH_EXIT');
    expect(leaked.stdout).not.toContain(value);

    const clean = runCli(['verify', '--file', cleanFile, '--env-file', envFile, 'SYNTH_EXIT']);
    expect(clean.status, `clean run failed, stderr: ${clean.stderr}`).toBe(0);
    expect(clean.stdout, `clean run stdout: ${clean.stdout}, stderr: ${clean.stderr}`).toContain(
      'result: clean',
    );
    expect(clean.stdout).not.toContain(value);
  }, 180000);
});
