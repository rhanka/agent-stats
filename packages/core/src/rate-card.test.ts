import { describe, expect, it } from 'vitest';

import { resolveRates } from './rate-card.js';

describe('resolveRates — Claude model aliases', () => {
  // Claude Code sometimes records the short alias (`opus`, `sonnet`, `haiku`)
  // instead of the full `claude-…` id. These are real API calls and must be
  // priced, not silently dropped to $0.
  it('prices the bare "opus" alias at the Opus tier', () => {
    const r = resolveRates('opus');
    expect(r.currency).toBe('claude_usd_cents');
    expect(r.newInputPerMillion).toBe(1500);
    expect(r.outputPerMillion).toBe(7500);
  });

  it('prices the bare "sonnet" alias at the Sonnet tier', () => {
    const r = resolveRates('sonnet');
    expect(r.currency).toBe('claude_usd_cents');
    expect(r.newInputPerMillion).toBe(300);
    expect(r.outputPerMillion).toBe(1500);
  });

  it('prices the bare "haiku" alias at the Haiku tier', () => {
    const r = resolveRates('haiku');
    expect(r.currency).toBe('claude_usd_cents');
    expect(r.newInputPerMillion).toBe(100);
    expect(r.outputPerMillion).toBe(500);
  });

  // Regression guard: opus-4-8 is the current generation and must be priced at
  // the published Opus tier (same as 4-7), never $0.
  it('prices claude-opus-4-8 at the Opus tier', () => {
    const r = resolveRates('claude-opus-4-8');
    expect(r.currency).toBe('claude_usd_cents');
    expect(r.newInputPerMillion).toBe(1500);
    expect(r.outputPerMillion).toBe(7500);
  });
});
