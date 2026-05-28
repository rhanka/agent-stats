/**
 * Cleanser: redact secrets (and optionally compact verbose tool outputs)
 * from agent-stats session jsonl files.
 *
 * Modes:
 *   - `archive`     : write a redacted copy into an output dir.
 *   - `inplace`     : rewrite the file in place after saving a `.bak`.
 *   - `llm-input`   : same as `archive` plus truncate tool-result strings
 *                     longer than `maxToolResultBytes`.
 *
 * Replacement marker is `<<SECRET:<ruleId>:<hash>>>` where `<hash>` is the
 * first 16 hex chars of sha256(secret); identical secrets keep the same
 * tag across files, which is handy for dedup analysis.
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scanString, type CustomSecretPattern } from './secrets.js';

export type CleanMode = 'archive' | 'inplace' | 'llm-input';

export interface CleanFileOptions {
  /** Absolute path of the source jsonl. */
  filePath: string;
  /** Output mode. */
  mode?: CleanMode;
  /**
   * Output file path; required for `archive` and `llm-input` modes.
   * Ignored for `inplace`.
   */
  outputPath?: string;
  /**
   * For `llm-input`: truncate any string longer than this many bytes.
   * Default 2048.
   */
  maxToolResultBytes?: number;
  /**
   * For tests: skip the secret scan and only handle truncation.
   * Default false.
   */
  skipSecrets?: boolean;
  /**
   * Extra org-specific secret regexes (on top of secretlint preset-recommend),
   * typically loaded from a YAML file via `loadSecretPatterns`.
   */
  customPatterns?: CustomSecretPattern[];
}

export interface CleanStats {
  filePath: string;
  outputPath: string;
  /** Number of secret matches found and redacted. */
  secretsFound: number;
  /** Number of strings truncated (llm-input mode). */
  truncations: number;
  /** Number of lines processed. */
  lines: number;
  /** Source byte size. */
  bytesIn: number;
  /** Output byte size. */
  bytesOut: number;
}

const sha256short = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

function redact(text: string, matches: Awaited<ReturnType<typeof scanString>>): string {
  if (matches.length === 0) return text;
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of sorted) {
    const secret = out.slice(m.start, m.end);
    const safeRule = m.ruleId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tag = `<<SECRET:${safeRule}:${sha256short(secret)}>>`;
    out = out.slice(0, m.start) + tag + out.slice(m.end);
  }
  return out;
}

interface CleanCtx {
  secretsFound: number;
  truncations: number;
  maxToolResultBytes: number;
  truncate: boolean;
  scanSecrets: boolean;
  customPatterns: CustomSecretPattern[];
}

async function cleanString(s: string, ctx: CleanCtx): Promise<string> {
  let out = s;
  if (ctx.scanSecrets && s.length >= 8) {
    const matches = await scanString(s, { customPatterns: ctx.customPatterns });
    if (matches.length > 0) {
      ctx.secretsFound += matches.length;
      out = redact(s, matches);
    }
  }
  if (ctx.truncate && Buffer.byteLength(out, 'utf8') > ctx.maxToolResultBytes) {
    ctx.truncations += 1;
    const kept = Buffer.from(out, 'utf8').subarray(0, ctx.maxToolResultBytes).toString('utf8');
    const dropped = Buffer.byteLength(out, 'utf8') - Buffer.byteLength(kept, 'utf8');
    out = `${kept}…[${dropped} bytes truncated by agent-stats clean]`;
  }
  return out;
}

async function cleanJson(val: unknown, ctx: CleanCtx): Promise<unknown> {
  if (typeof val === 'string') return cleanString(val, ctx);
  if (Array.isArray(val)) {
    const out: unknown[] = [];
    for (const item of val) out.push(await cleanJson(item, ctx));
    return out;
  }
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = await cleanJson(v, ctx);
    return out;
  }
  return val;
}

/**
 * Clean a single jsonl file. Writes the redacted version according to the
 * requested mode and returns aggregate stats.
 */
export async function cleanFile(opts: CleanFileOptions): Promise<CleanStats> {
  const mode: CleanMode = opts.mode ?? 'archive';
  const src = await readFile(opts.filePath, 'utf8');
  const ctx: CleanCtx = {
    secretsFound: 0,
    truncations: 0,
    maxToolResultBytes: opts.maxToolResultBytes ?? 2048,
    truncate: mode === 'llm-input',
    scanSecrets: !opts.skipSecrets,
    customPatterns: opts.customPatterns ?? [],
  };

  const lines = src.split('\n');
  const outLines: string[] = [];
  let processed = 0;
  for (const line of lines) {
    if (!line.trim()) {
      outLines.push(line);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not JSON: scan as raw text (defensive — still redact).
      outLines.push(await cleanString(line, ctx));
      processed += 1;
      continue;
    }
    const redacted = await cleanJson(parsed, ctx);
    outLines.push(JSON.stringify(redacted));
    processed += 1;
  }
  const cleaned = outLines.join('\n');

  let outputPath: string;
  if (mode === 'inplace') {
    outputPath = opts.filePath;
    const bak = `${opts.filePath}.bak`;
    await copyFile(opts.filePath, bak);
    const tmp = `${opts.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, cleaned);
    await rename(tmp, opts.filePath);
  } else {
    if (!opts.outputPath) {
      throw new Error(`cleanFile: --output is required for mode "${mode}"`);
    }
    outputPath = opts.outputPath;
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, cleaned);
  }

  return {
    filePath: opts.filePath,
    outputPath,
    secretsFound: ctx.secretsFound,
    truncations: ctx.truncations,
    lines: processed,
    bytesIn: Buffer.byteLength(src, 'utf8'),
    bytesOut: Buffer.byteLength(cleaned, 'utf8'),
  };
}
