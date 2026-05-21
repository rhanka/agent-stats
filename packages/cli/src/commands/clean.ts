/**
 * `agent-stats clean` — redact secrets in session jsonl files.
 *
 * Operates on a single file (`--input` is a file) or recursively on a
 * directory (`--input` is a dir). Mirrors the directory structure under
 * `--out` in `archive` and `llm-input` modes; rewrites in place (with a
 * `.bak`) in `inplace` mode.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { cleanFile, type CleanMode, type CleanStats } from '@sentropic/agent-stats-core';

export interface CleanCommandOptions {
  input: string;
  mode?: CleanMode;
  out?: string;
  maxToolResultBytes?: number;
}

export interface CleanCommandResult {
  output: string;
  totals: {
    files: number;
    secretsFound: number;
    truncations: number;
    bytesIn: number;
    bytesOut: number;
  };
  perFile: CleanStats[];
}

async function listJsonlFiles(input: string): Promise<string[]> {
  const s = await stat(input);
  if (s.isFile()) return [input];
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  await walk(input);
  return out;
}

export async function runClean(opts: CleanCommandOptions): Promise<CleanCommandResult> {
  const mode: CleanMode = opts.mode ?? 'archive';
  if ((mode === 'archive' || mode === 'llm-input') && !opts.out) {
    throw new Error(`--out is required for --mode ${mode}`);
  }
  const files = await listJsonlFiles(opts.input);
  const inputStat = await stat(opts.input);
  const baseDir = inputStat.isDirectory() ? opts.input : path.dirname(opts.input);

  const perFile: CleanStats[] = [];
  const totals = { files: 0, secretsFound: 0, truncations: 0, bytesIn: 0, bytesOut: 0 };

  for (const file of files) {
    let outputPath: string | undefined;
    if (mode !== 'inplace') {
      const rel = path.relative(baseDir, file);
      outputPath = path.join(opts.out!, rel);
    }
    const r = await cleanFile({
      filePath: file,
      mode,
      ...(outputPath ? { outputPath } : {}),
      ...(opts.maxToolResultBytes !== undefined
        ? { maxToolResultBytes: opts.maxToolResultBytes }
        : {}),
    });
    perFile.push(r);
    totals.files += 1;
    totals.secretsFound += r.secretsFound;
    totals.truncations += r.truncations;
    totals.bytesIn += r.bytesIn;
    totals.bytesOut += r.bytesOut;
  }

  const output = [
    `agent-stats clean — mode=${mode}`,
    `Files processed: ${totals.files}`,
    `Secrets found:   ${totals.secretsFound}`,
    `Truncations:     ${totals.truncations}`,
    `Bytes in → out:  ${totals.bytesIn.toLocaleString()} → ${totals.bytesOut.toLocaleString()}`,
  ].join('\n');

  return { output, totals, perFile };
}
