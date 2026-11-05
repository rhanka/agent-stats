/**
 * Verify a file against secret values named in a `.env` file.
 *
 * Given a target file plus a list of env-var NAMES, counts how many times
 * each value occurs in the target — raw and base64-encoded — without ever
 * placing a value in `argv` or on `stdout`. Only names, counts and sha256
 * fingerprints are reported. The result is `leaked` when any count is above
 * zero (the CLI exits non-zero in that case).
 *
 * Both the `.env` file and the target are read through an open file
 * descriptor (`fs.open` handle); values live only in process memory.
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export interface VerifyOptions {
  /** File to scan for leaked values. */
  filePath: string;
  /** `.env`-format file holding the secret values. */
  envFilePath: string;
  /** Env-var NAMES to check (values are read from `envFilePath`). */
  varNames: string[];
}

export interface VerifyEntry {
  /** Env-var name (never secret). */
  name: string;
  /** Occurrences of the raw value. */
  rawCount: number;
  /** Occurrences of the base64-encoded value (padded + unpadded). */
  base64Count: number;
  /** Total occurrences (`rawCount + base64Count`). */
  count: number;
  /** First 16 hex chars of sha256(value) — identifies the value blind. */
  sha256: string;
}

export interface VerifyResult {
  filePath: string;
  entries: VerifyEntry[];
  totalHits: number;
  /** True when any entry has a count above zero. */
  leaked: boolean;
  /** Printable report: names, counts and fingerprints only. */
  output: string;
}

/** Read a whole file through an open file descriptor. */
async function readThroughFd(filePath: string): Promise<string> {
  const fh = await open(filePath, 'r');
  try {
    return await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Minimal `.env` parser: `KEY=value`, `export KEY=value`, `#` comments. */
function parseEnv(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const name = body.slice(0, eq).trim();
    if (!ENV_NAME.test(name)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out.set(name, value);
  }
  return out;
}

const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

/** Non-overlapping occurrences of `needle` in `haystack` (0 for empty). */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * Count raw + base64 occurrences. Values stay in memory only; the returned
 * entry carries counts and the fingerprint, never the value.
 */
function countValue(haystack: string, value: string): { rawCount: number; base64Count: number } {
  const rawCount = countOccurrences(haystack, value);
  const padded = Buffer.from(value, 'utf8').toString('base64');
  const unpadded = padded.replace(/=+$/, '');
  let base64Count = countOccurrences(haystack, padded);
  if (unpadded !== padded && unpadded.length >= 8) {
    // Mask padded hits so the unpadded prefix of the same blob is not
    // counted twice.
    const masked = haystack.split(padded).join(' '.repeat(padded.length));
    base64Count += countOccurrences(masked, unpadded);
  }
  return { rawCount, base64Count };
}

/**
 * Scan `filePath` for the values of `varNames` read from `envFilePath`.
 * Throws with the var index only (never the token) for unknown or empty
 * vars — fail closed without echoing argv into stderr or logs.
 */
export async function verifyFile(opts: VerifyOptions): Promise<VerifyResult> {
  if (opts.varNames.length === 0) {
    throw new Error('verifyFile: at least one var name is required');
  }
  const env = parseEnv(await readThroughFd(opts.envFilePath));
  const haystack = await readThroughFd(opts.filePath);

  const entries: VerifyEntry[] = [];
  for (let i = 0; i < opts.varNames.length; i++) {
    const name = opts.varNames[i]!;
    if (!ENV_NAME.test(name)) {
      throw new Error(`verifyFile: invalid var name at index ${i}`);
    }
    if (!env.has(name)) {
      throw new Error(`verifyFile: unknown var at index ${i} in env file`);
    }
    const value = env.get(name)!;
    if (!value) {
      throw new Error(`verifyFile: empty value for var at index ${i}`);
    }
    const { rawCount, base64Count } = countValue(haystack, value);
    entries.push({
      name,
      rawCount,
      base64Count,
      count: rawCount + base64Count,
      sha256: fingerprint(value),
    });
  }

  const totalHits = entries.reduce((sum, e) => sum + e.count, 0);
  const leaked = totalHits > 0;
  const lines = [
    `agent-stats verify — file=${opts.filePath}`,
    ...entries.map(
      (e) =>
        `${e.name}: count=${e.count} (raw=${e.rawCount} base64=${e.base64Count}) sha256=${e.sha256}`,
    ),
    leaked ? 'result: LEAKED (exit 1)' : 'result: clean (exit 0)',
  ];
  return { filePath: opts.filePath, entries, totalHits, leaked, output: lines.join('\n') };
}
