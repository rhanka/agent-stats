/**
 * `agent-stats verify` — check a file for leaked secret values without ever
 * exposing the values themselves.
 *
 * Values are read from a `.env`-format file through a file descriptor; only
 * the var NAMES come from argv. stdout carries names, counts and sha256
 * fingerprints only. `leaked` is true (and the CLI exits non-zero) when any
 * count is above zero.
 */

import { verifyFile, type VerifyEntry } from '@sentropic/agent-stats-core';

export interface VerifyCommandOptions {
  file: string;
  envFile: string;
  vars: string[];
}

export interface VerifyCommandResult {
  output: string;
  leaked: boolean;
  totalHits: number;
  entries: VerifyEntry[];
}

export async function runVerify(opts: VerifyCommandOptions): Promise<VerifyCommandResult> {
  if (opts.vars.length === 0) {
    throw new Error('at least one VAR name is required');
  }
  const r = await verifyFile({
    filePath: opts.file,
    envFilePath: opts.envFile,
    varNames: opts.vars,
  });
  return { output: r.output, leaked: r.leaked, totalHits: r.totalHits, entries: r.entries };
}
