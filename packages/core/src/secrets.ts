/**
 * Thin wrapper over secretlint to scan ad-hoc strings.
 *
 * Uses the preset-recommend bundle as the default rule set. The function
 * returns the list of match ranges so callers can either redact in place
 * (cleanser) or report them (anomalies / audit).
 */

import { lintSource } from '@secretlint/core';
import { creator as presetRecommend } from '@secretlint/secretlint-rule-preset-recommend';
import type { SecretLintCoreConfig } from '@secretlint/types';

export interface SecretMatch {
  /** UTF-16 code unit offset where the secret starts in the source string. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Rule id reporting the match (e.g. `@secretlint/secretlint-rule-aws`). */
  ruleId: string;
  /** Human-readable message. */
  message: string;
}

const DEFAULT_CONFIG: SecretLintCoreConfig = {
  rules: [
    {
      id: '@secretlint/secretlint-rule-preset-recommend',
      rule: presetRecommend,
    },
  ],
};

/**
 * Scan a single string for secrets. Returns an empty array if nothing
 * looks suspicious. Safe to call on small or empty strings — secretlint
 * short-circuits.
 */
export async function scanString(text: string, filePath = 'inline.txt'): Promise<SecretMatch[]> {
  if (!text) return [];
  const result = await lintSource({
    source: {
      filePath,
      content: text,
      contentType: 'text',
    },
    options: {
      config: DEFAULT_CONFIG,
      maskSecrets: false,
      noPhysicFilePath: true,
    },
  });
  return (result.messages ?? []).map((m) => ({
    start: m.range[0],
    end: m.range[1],
    ruleId: m.ruleId,
    message: m.message,
  }));
}
