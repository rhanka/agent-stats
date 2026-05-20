/**
 * Rate cards used to estimate the credits / cost burnt by each turn.
 *
 * Two distinct currencies coexist:
 *   - **Codex credits**: published in OpenAI's Codex rate card (credits /
 *     1M tokens). The Pro weekly bucket sums these.
 *   - **Claude USD cents**: Anthropic's public API list price, expressed as
 *     `100 × $` per 1M tokens, so a $1.25 input rate becomes 125.
 *
 * Mixing the two in the same aggregate makes no sense; the aggregator splits
 * them into separate sub-totals (`codexCredits` vs `claudeUsdCents`).
 *
 * Sources (May 2026):
 *   - Codex rate card (developers.openai.com/codex/pricing,
 *     help.openai.com codex-rate-card)
 *   - Anthropic pricing page
 *   - Cross-referenced with the project memory
 *     `reference_codex-quota-equation`
 *
 * All numbers may drift; update from the source when OpenAI / Anthropic
 * change their public pricing.
 */

import type { Usage } from './schema.js';

export type CostCurrency = 'codex_credits' | 'claude_usd_cents' | 'unknown';

/** Rate weights per 1M tokens for one model. */
export interface ModelRates {
  newInputPerMillion: number;
  cachedPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
  currency: CostCurrency;
}

export const ZERO_RATES: ModelRates = {
  newInputPerMillion: 0,
  cachedPerMillion: 0,
  cacheWritePerMillion: 0,
  outputPerMillion: 0,
  currency: 'unknown',
};

/**
 * Default rate card. Keys MUST match the model id reported by the parser
 * (Codex `model_provider` value, Claude `message.model` value). Aliases /
 * fallbacks are resolved by `resolveRates`.
 */
export const DEFAULT_RATE_CARD: Record<string, ModelRates> = {
  // ----- Codex / OpenAI (credits per 1M tokens) -----
  'gpt-5.5': {
    newInputPerMillion: 125,
    cachedPerMillion: 12.5,
    cacheWritePerMillion: 0,
    outputPerMillion: 750,
    currency: 'codex_credits',
  },
  'gpt-5.4': {
    newInputPerMillion: 62.5,
    cachedPerMillion: 6.25,
    cacheWritePerMillion: 0,
    outputPerMillion: 375,
    currency: 'codex_credits',
  },
  'gpt-5.4-mini': {
    newInputPerMillion: 18.75,
    cachedPerMillion: 1.875,
    cacheWritePerMillion: 0,
    outputPerMillion: 113,
    currency: 'codex_credits',
  },
  'gpt-5.3-codex': {
    newInputPerMillion: 43.75,
    cachedPerMillion: 4.375,
    cacheWritePerMillion: 0,
    outputPerMillion: 350,
    currency: 'codex_credits',
  },
  'gpt-5.3-codex-spark': {
    // Spark rates are not published; ratio guess based on `gpt-5.4-mini`.
    // Treat with caveat; the aggregator marks this as such via currency.
    newInputPerMillion: 18.75,
    cachedPerMillion: 1.875,
    cacheWritePerMillion: 0,
    outputPerMillion: 113,
    currency: 'codex_credits',
  },
  'codex-auto-review': {
    // Inferred (not published). Treated like mini for the auto-review pass.
    newInputPerMillion: 18.75,
    cachedPerMillion: 1.875,
    cacheWritePerMillion: 0,
    outputPerMillion: 113,
    currency: 'codex_credits',
  },

  // ----- Claude / Anthropic (USD cents per 1M tokens) -----
  'claude-opus-4-7': {
    newInputPerMillion: 1500, // $15
    cachedPerMillion: 150, // $1.50 (cache_read 10%)
    cacheWritePerMillion: 1875, // $18.75 (cache_creation 1.25×)
    outputPerMillion: 7500, // $75
    currency: 'claude_usd_cents',
  },
  'claude-sonnet-4-6': {
    newInputPerMillion: 300,
    cachedPerMillion: 30,
    cacheWritePerMillion: 375,
    outputPerMillion: 1500,
    currency: 'claude_usd_cents',
  },
  'claude-haiku-4-5-20251001': {
    newInputPerMillion: 100,
    cachedPerMillion: 10,
    cacheWritePerMillion: 125,
    outputPerMillion: 500,
    currency: 'claude_usd_cents',
  },
};

/**
 * Resolve the rate-card entry for a model. Returns `ZERO_RATES` when the
 * model is not registered, so callers always get a defined value.
 */
export function resolveRates(
  model: string | undefined,
  card: Record<string, ModelRates> = DEFAULT_RATE_CARD,
): ModelRates {
  if (!model) return ZERO_RATES;
  if (card[model]) return card[model];

  // alias resolution: prefix match (`claude-opus-4-7-thinking` → `claude-opus-4-7`)
  // and `claude-haiku-X` family fallback.
  for (const key of Object.keys(card)) {
    if (model.startsWith(key)) return card[key]!;
  }
  // common families
  if (model.startsWith('claude-haiku')) return card['claude-haiku-4-5-20251001']!;
  if (model.startsWith('claude-sonnet')) return card['claude-sonnet-4-6']!;
  if (model.startsWith('claude-opus')) return card['claude-opus-4-7']!;
  return ZERO_RATES;
}

/** Compute the cost of a single turn's usage given the model. */
export function estimateCost(
  usage: Usage,
  rates: ModelRates,
): { amount: number; currency: CostCurrency } {
  const amount =
    (usage.newInputTokens * rates.newInputPerMillion +
      usage.cachedInputTokens * rates.cachedPerMillion +
      usage.cacheWriteTokens * rates.cacheWritePerMillion +
      usage.outputTokens * rates.outputPerMillion) /
    1_000_000;
  return { amount, currency: rates.currency };
}
