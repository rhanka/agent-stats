import { describe, expect, it } from 'vitest';

import { mcpBucket, mergeNameCounts, topN } from './tool-stats.js';

describe('mcpBucket', () => {
  it('collapses an MCP tool id to a mcp:server bucket', () => {
    expect(mcpBucket('mcp__playwright__browser_click')).toBe('mcp:playwright');
  });
  it('keeps the server when the tool segment has triple underscores', () => {
    expect(mcpBucket('mcp__codex_apps__github___get_repo')).toBe('mcp:codex_apps');
  });
  it('handles server names that themselves contain underscores', () => {
    expect(mcpBucket('mcp__claude_ai_Gmail__search_threads')).toBe('mcp:claude_ai_Gmail');
  });
  it('handles a trailing empty tool segment', () => {
    expect(mcpBucket('mcp__datagouv__')).toBe('mcp:datagouv');
  });
  it('leaves non-MCP tools untouched', () => {
    expect(mcpBucket('Bash')).toBe('Bash');
  });
});

describe('mergeNameCounts', () => {
  it('sums counts across maps and applies the key normalizer', () => {
    const merged = mergeNameCounts(
      [
        { mcp__playwright__browser_click: 3, Bash: 2 },
        { mcp__playwright__browser_snapshot: 4, Bash: 1 },
      ],
      mcpBucket,
    );
    expect(merged).toEqual({ 'mcp:playwright': 7, Bash: 3 });
  });
  it('is an identity merge without a normalizer', () => {
    expect(mergeNameCounts([{ a: 1 }, { a: 2, b: 5 }])).toEqual({ a: 3, b: 5 });
  });
});

describe('topN', () => {
  it('orders by count desc then name asc, and truncates to n', () => {
    expect(topN({ a: 5, b: 5, c: 9, d: 1 }, 3)).toEqual([
      { name: 'c', count: 9 },
      { name: 'a', count: 5 },
      { name: 'b', count: 5 },
    ]);
  });
});
