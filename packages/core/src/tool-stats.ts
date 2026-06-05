/**
 * Helpers to surface tool / skill usage as top-N tables.
 *
 * MCP tools are reported as a single `mcp:{server}` bucket rather than one row
 * per leaf tool (e.g. `mcp__playwright__browser_click`), so a chatty server
 * does not flood the table. Native tools (Bash, Read, …) keep their name.
 */

/** Collapse an MCP tool id (`mcp__server__tool…`) to a `mcp:{server}` bucket. */
export function mcpBucket(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  // The server is always the first `__`-delimited segment after the `mcp__`
  // prefix, even when the tool part contains extra underscores.
  const server = name.slice(5).split('__')[0];
  return server ? `mcp:${server}` : 'mcp:unknown';
}

/** Sum a list of name→count maps, optionally normalizing each key. */
export function mergeNameCounts(
  maps: Array<Record<string, number>>,
  normalize: (name: string) => string = (n) => n,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      const key = normalize(k);
      out[key] = (out[key] ?? 0) + v;
    }
  }
  return out;
}

export interface NameCount {
  name: string;
  count: number;
}

/**
 * Top-N entries from a name→count map. Deterministic ordering: count
 * descending, then name ascending to break ties.
 */
export function topN(counts: Record<string, number>, n: number): NameCount[] {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}
