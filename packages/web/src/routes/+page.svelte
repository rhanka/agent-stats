<script lang="ts">
  import {
    Card,
    Button,
    Select,
    Badge,
    DataTable,
    EmptyState,
    Alert,
  } from '@sentropic/design-system-svelte';
  import type { DataTableColumn, DataTableRow } from '@sentropic/design-system-svelte';
  import { base } from '$app/paths';

  type WeeklyAggregation = {
    weekStart: string;
    projectCwd: string;
    tool: 'claude' | 'codex';
    model: string;
    sessions: number;
    turns: number;
    totalUsage: {
      newInputTokens: number;
      cachedInputTokens: number;
      cacheWriteTokens: number;
      outputTokens: number;
      reasoningTokens: number;
    };
    estimatedCost: { codexCredits: number; claudeUsdCents: number; unknown: number };
    rateLimitMax?: { primaryPercent: number; secondaryPercent: number };
    repoUrl?: string;
  };

  let rows: WeeklyAggregation[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let published = $state(false);
  let publishedAt: string | null = $state(null);

  // Default: last 7 days.
  let sinceDays = $state(7);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    published = false;
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await fetch(`/api/stats?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = (await res.json()) as WeeklyAggregation[];
    } catch (e) {
      // No live API (the static public site): fall back to the published
      // snapshot — the maintainer's own usage, computed locally and committed,
      // with projects relabelled to their public git repos.
      try {
        const snap = await fetch(`${base}/published-stats.json`);
        if (!snap.ok) throw new Error(`snapshot HTTP ${snap.status}`);
        rows = (await snap.json()) as WeeklyAggregation[];
        published = true;
        try {
          const meta = await fetch(`${base}/published-meta.json`);
          if (meta.ok) publishedAt = ((await meta.json()) as { generatedAt?: string }).generatedAt ?? null;
        } catch {
          /* meta optional */
        }
      } catch {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function fmt(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toString();
  }

  function totalInput(r: WeeklyAggregation): number {
    const u = r.totalUsage;
    return u.newInputTokens + u.cachedInputTokens + u.cacheWriteTokens;
  }

  function costString(r: WeeklyAggregation): string {
    const parts: string[] = [];
    if (r.estimatedCost.codexCredits > 0) {
      parts.push(`${r.estimatedCost.codexCredits.toFixed(0)} cr`);
    }
    if (r.estimatedCost.claudeUsdCents > 0) {
      // notional API-equivalent, not real spend on a flat-rate Max plan
      parts.push(`~$${(r.estimatedCost.claudeUsdCents / 100).toFixed(2)}`);
    }
    return parts.length ? parts.join(' + ') : '-';
  }

  // The published snapshot is a fixed 180-day file, so the "since" selector
  // can't hit an API — filter it client-side by weekStart instead. In live
  // mode the API already filtered, so this is a passthrough.
  let displayRows = $derived.by<WeeklyAggregation[]>(() => {
    if (!published) return rows;
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    return rows.filter((r) => r.weekStart >= cutoff);
  });

  let totals = $derived.by(() => {
    let sessions = 0;
    let turns = 0;
    let inputTotal = 0;
    let outputTotal = 0;
    let cached = 0;
    let codexCredits = 0;
    let claudeUsdCents = 0;
    for (const r of displayRows) {
      sessions += r.sessions;
      turns += r.turns;
      inputTotal += totalInput(r);
      outputTotal += r.totalUsage.outputTokens;
      cached += r.totalUsage.cachedInputTokens;
      codexCredits += r.estimatedCost.codexCredits;
      claudeUsdCents += r.estimatedCost.claudeUsdCents;
    }
    let peak5h = 0;
    let peak7d = 0;
    for (const r of displayRows) {
      if (r.rateLimitMax) {
        peak5h = Math.max(peak5h, r.rateLimitMax.primaryPercent);
        peak7d = Math.max(peak7d, r.rateLimitMax.secondaryPercent);
      }
    }
    const cacheHit = inputTotal > 0 ? (cached / inputTotal) * 100 : 0;
    return {
      sessions,
      turns,
      inputTotal,
      outputTotal,
      cached,
      cacheHit,
      codexCredits,
      claudeUsdCents,
      peak5h,
      peak7d,
    };
  });

  let costTotalString = $derived.by(() => {
    const parts: string[] = [];
    if (totals.codexCredits > 0) parts.push(`${totals.codexCredits.toFixed(0)} cr`);
    // Claude $ is notional (API list price), not real spend on a flat-rate Max plan.
    if (totals.claudeUsdCents > 0) parts.push(`~$${(totals.claudeUsdCents / 100).toFixed(2)}`);
    return parts.length ? parts.join(' + ') : '-';
  });

  // --- Top projects table ---
  let projectRows = $derived.by<DataTableRow[]>(() => {
    const m = new Map<string, { cwd: string; url?: string; tokens: number; sessions: number }>();
    for (const r of displayRows) {
      let acc = m.get(r.projectCwd);
      if (!acc) {
        acc = { cwd: r.projectCwd, tokens: 0, sessions: 0 };
        if (r.repoUrl) acc.url = r.repoUrl;
        m.set(r.projectCwd, acc);
      }
      acc.tokens += totalInput(r) + r.totalUsage.outputTokens;
      acc.sessions += r.sessions;
    }
    return [...m.values()]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10)
      .map((p) => ({
        id: p.cwd,
        project: p.cwd,
        repoUrl: p.url ?? '',
        sessions: p.sessions,
        tokens: fmt(p.tokens),
      }));
  });

  const projectColumns: DataTableColumn[] = [
    { key: 'project', label: 'Project', cell: projectCell },
    { key: 'sessions', label: 'Sessions', align: 'end' },
    { key: 'tokens', label: 'Tokens (in+out)', align: 'end' },
  ];

  // --- All aggregations table ---
  let aggRows = $derived.by<DataTableRow[]>(() =>
    displayRows.map((r) => ({
      id: r.weekStart + r.projectCwd + r.tool + r.model,
      week: r.weekStart,
      tool: r.tool,
      project: r.projectCwd,
      repoUrl: r.repoUrl ?? '',
      model: r.model,
      sessions: r.sessions,
      turns: r.turns,
      input: fmt(totalInput(r)),
      output: fmt(r.totalUsage.outputTokens),
      cost: costString(r),
    })),
  );

  const aggColumns: DataTableColumn[] = [
    { key: 'week', label: 'Week', sortable: true },
    { key: 'tool', label: 'Tool', cell: toolCell, sortable: true },
    { key: 'project', label: 'Project', cell: projectCell },
    { key: 'model', label: 'Model', sortable: true },
    { key: 'sessions', label: 'Sess', align: 'end', sortable: true },
    { key: 'turns', label: 'Turns', align: 'end', sortable: true },
    { key: 'input', label: 'In', align: 'end' },
    { key: 'output', label: 'Out', align: 'end' },
    { key: 'cost', label: 'Cost', align: 'end' },
  ];
</script>

{#snippet projectCell(row: DataTableRow)}
  {#if row.repoUrl}
    <a href={String(row.repoUrl)} target="_blank" rel="noreferrer noopener"><code>{row.project}</code></a>
  {:else}
    <code>{row.project}</code>
  {/if}
{/snippet}

{#snippet toolCell(row: DataTableRow)}
  <Badge tone={row.tool === 'claude' ? 'info' : 'success'}>{row.tool}</Badge>
{/snippet}

<h1>Overview — last {sinceDays} days</h1>

<div class="controls">
  <Select size="sm" aria-label="Since" bind:value={sinceDays} onchange={() => load()}>
    <option value={2}>2 days</option>
    <option value={7}>7 days</option>
    <option value={14}>14 days</option>
    <option value={30}>30 days</option>
    <option value={90}>90 days</option>
  </Select>
  <Button variant="secondary" size="sm" onclick={() => load()}>Refresh</Button>
</div>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <EmptyState
    title="No live data"
    message="This dashboard reads your local sessions through a small API. The static site (e.g. agent-stats.sent-tech.ca) has no backend, so there is nothing to show here. Run it locally to analyze your own data."
  >
    {#snippet action()}
      <code>npx @sentropic/agent-stats web</code>
      <p class="hint">then open http://127.0.0.1:4173 — detail: {error}</p>
    {/snippet}
  </EmptyState>
{:else}
  {#if published}
    <div class="banner">
      <Alert
        tone="info"
        title="Published snapshot — real usage"
        message={`The maintainer's own Claude Code + Codex usage, computed locally and committed (projects link to their public git repos)${publishedAt ? `. Generated ${publishedAt.slice(0, 10)}` : ''}. Run \`npx @sentropic/agent-stats web\` for your own.`}
      />
    </div>
  {/if}
  <section class="cards">
    <Card>
      <div class="label">Sessions</div>
      <div class="value">{totals.sessions}</div>
    </Card>
    <Card>
      <div class="label">Turns</div>
      <div class="value">{totals.turns}</div>
    </Card>
    <Card>
      <div class="label">Input tokens</div>
      <div class="value">{fmt(totals.inputTotal)}</div>
      <div class="sub">{totals.cacheHit.toFixed(1)}% cache hit</div>
    </Card>
    <Card>
      <div class="label">Output tokens</div>
      <div class="value">{fmt(totals.outputTotal)}</div>
    </Card>
    <Card>
      <div class="label">Estimated cost</div>
      <div class="value">{costTotalString}</div>
      <div class="sub">Codex = credits · Claude ~$ notional (flat-rate Max)</div>
    </Card>
    <Card>
      <div class="label">Codex quota peak</div>
      <div class="value">{totals.peak7d.toFixed(0)}%</div>
      <div class="sub">7-day window · 5h peak {totals.peak5h.toFixed(0)}%</div>
    </Card>
  </section>

  <h2>Top projects</h2>
  <DataTable
    columns={projectColumns}
    rows={projectRows}
    size="sm"
    emptyLabel="No data in this window."
  />

  <h2>All aggregations ({displayRows.length} rows)</h2>
  <DataTable
    columns={aggColumns}
    rows={aggRows}
    size="sm"
    sortable
    pageSize={25}
    emptyLabel="No data in this window."
  />
{/if}

<style>
  h1,
  h2 {
    color: var(--st-semantic-text-primary);
  }
  .controls {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    margin: 16px 0 24px;
  }
  .banner {
    margin: 0 0 20px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 16px 0 24px;
  }
  .label {
    font-size: 12px;
    color: var(--st-semantic-text-muted, var(--st-semantic-text-secondary));
  }
  .value {
    font-size: 22px;
    font-weight: 600;
    margin-top: 4px;
    color: var(--st-semantic-text-primary);
  }
  .sub {
    font-size: 11px;
    color: var(--st-semantic-text-link, var(--st-semantic-text-secondary));
    margin-top: 4px;
  }
  code {
    background: var(--st-semantic-surface-subtle, var(--st-semantic-surface-raised));
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }
  a code {
    color: var(--st-semantic-text-link, var(--st-semantic-text-primary));
    cursor: pointer;
  }
  a:hover code {
    text-decoration: underline;
  }
  .hint {
    font-size: 12px;
    color: var(--st-semantic-text-muted, var(--st-semantic-text-secondary));
    margin-top: 8px;
  }
</style>
