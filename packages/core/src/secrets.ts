/**
 * Secret scanning. Combines two sources:
 *   1. secretlint preset-recommend (28 rules: AWS, Anthropic, OpenAI, GitHub,
 *      GitLab, Slack, Stripe, JWT, private keys, …) — the generic baseline.
 *   2. Optional **custom patterns** (regexes), e.g. an organisation's internal
 *      token formats that the generic rules don't know about. These are loaded
 *      from a small YAML file (see `loadSecretPatterns`).
 *
 * Returns match ranges so callers can redact in place (cleanser) or report
 * them (audit). The two sources are merged and overlapping ranges are kept
 * once so a string is never double-redacted.
 */

import { readFileSync } from 'node:fs';

import { lintSource } from '@secretlint/core';
import { creator as presetRecommend } from '@secretlint/secretlint-rule-preset-recommend';
import type { SecretLintCoreConfig } from '@secretlint/types';
import yaml from 'js-yaml';

export interface SecretMatch {
  /** UTF-16 code unit offset where the secret starts in the source string. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Rule id reporting the match (e.g. `@secretlint/secretlint-rule-aws`, or
   *  `custom:<id>` for a user pattern). */
  ruleId: string;
  /** Human-readable message. */
  message: string;
}

/** A user-supplied secret pattern (regex). */
export interface CustomSecretPattern {
  /** Short identifier, surfaced in the redaction tag as `custom:<id>`. */
  id: string;
  /** JavaScript regular-expression source. */
  pattern: string;
  /** Regex flags; `g` is always enforced. Default `''`. */
  flags?: string;
}

const DEFAULT_CONFIG: SecretLintCoreConfig = {
  rules: [
    {
      id: '@secretlint/secretlint-rule-preset-recommend',
      rule: presetRecommend,
    },
  ],
};

export interface ScanOptions {
  /** Logical file path passed to secretlint (affects nothing material). */
  filePath?: string;
  /** Extra regex patterns to apply on top of the preset rules. */
  customPatterns?: CustomSecretPattern[];
}

/**
 * Load custom secret patterns from a YAML file. Accepts either a top-level
 * list, or a `patterns:` key holding the list:
 *
 *   - id: sentropic-token
 *     pattern: "stp_[A-Za-z0-9]{32}"
 *     flags: ""
 *
 * Invalid entries are skipped defensively (bad regex, missing fields).
 */
export function loadSecretPatterns(filePath: string): CustomSecretPattern[] {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { patterns?: unknown }).patterns)
      ? (raw as { patterns: unknown[] }).patterns
      : [];
  const out: CustomSecretPattern[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, pattern, flags } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof pattern !== 'string') continue;
    try {
      new RegExp(pattern, typeof flags === 'string' ? flags : ''); // validate
    } catch {
      continue;
    }
    out.push({ id, pattern, ...(typeof flags === 'string' ? { flags } : {}) });
  }
  return out;
}

function scanCustom(text: string, patterns: CustomSecretPattern[]): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const p of patterns) {
    let re: RegExp;
    try {
      const flags = new Set((p.flags ?? '').split(''));
      flags.add('g'); // global is required to walk all occurrences
      re = new RegExp(p.pattern, [...flags].join(''));
    } catch {
      continue;
    }
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || m[0].length === 0) continue;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        ruleId: `custom:${p.id}`,
        message: `custom pattern ${p.id}`,
      });
    }
  }
  return matches;
}

/** Drop ranges fully covered by an earlier-starting / longer range. */
function dedupeRanges(matches: SecretMatch[]): SecretMatch[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: SecretMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd || m.end > lastEnd) {
      kept.push(m);
      lastEnd = Math.max(lastEnd, m.end);
    }
  }
  return kept;
}

/**
 * Scan a single string for secrets (preset rules + optional custom patterns).
 * Returns an empty array if nothing looks suspicious. Safe on empty strings.
 */
export async function scanString(text: string, opts: ScanOptions = {}): Promise<SecretMatch[]> {
  if (!text) return [];
  const result = await lintSource({
    source: {
      filePath: opts.filePath ?? 'inline.txt',
      content: text,
      contentType: 'text',
    },
    options: {
      config: DEFAULT_CONFIG,
      maskSecrets: false,
      noPhysicFilePath: true,
    },
  });
  const preset: SecretMatch[] = (result.messages ?? []).map((m) => ({
    start: m.range[0],
    end: m.range[1],
    ruleId: m.ruleId,
    message: m.message,
  }));
  const custom = opts.customPatterns?.length ? scanCustom(text, opts.customPatterns) : [];
  return dedupeRanges([...preset, ...custom]);
}
