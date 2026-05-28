<script lang="ts">
  import {
    Card,
    Button,
    Select,
    Badge,
    DataTable,
    EmptyState,
    Alert,
    BarChart,
    Sparkline,
  } from '@sentropic/design-system-svelte';
  import type { DataTableColumn, DataTableRow } from '@sentropic/design-system-svelte';
  import { base } from '$app/paths';
  import { periodSeries, type SeriesMetric } from '@sentropic/agent-stats-core';
  import MultiLineChart from '$lib/MultiLineChart.svelte';
  import { i18n } from '$lib/i18n.svelte';
  const t = (k: Parameters<typeof i18n.t>[0], v?: Record<string, string | number>) => i18n.t(k, v);

  // Daily granularity threshold (windows ≤ this many days are bucketed per day).
  const DAILY_MAX_DAYS = 60;
  const PROVIDER_COLOR: Record<string, string> = {
    claude: 'var(--st-semantic-data-category1)',
    codex: 'var(--st-semantic-data-category2)',
    cursor: 'var(--st-semantic-data-category3)',
  };

  type WeeklyAggregation = {
    weekStart: string;
    projectCwd: string;
    tool: 'claude' | 'codex' | 'cursor';
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
    sessionsBySurface?: Record<string, number>;
    repoUrl?: string;
  };

  let rows: WeeklyAggregation[] = $state([]);
  // Published daily snapshot (recent ~60d), used for the <30d chart on the static site.
  let dailyRows: WeeklyAggregation[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let published = $state(false);
  let publishedAt: string | null = $state(null);

  // Default to a quarter so the time-series chart and sparklines have several
  // weeks to plot on first load (7 days = a single bucket = nothing to trend).
  let sinceDays = $state(90);

  // "Usage over time" chart controls.
  // Chart metric (token components have cached isolated & excluded from in/out).
  let chartMetric = $state<SeriesMetric>('inout');
  let chartWidth = $state(900);

  // Per-provider split via checkboxes → small multiples (one chart per checked).
  const ALL_PROVIDERS = ['claude', 'codex', 'cursor'] as const;
  type Provider = (typeof ALL_PROVIDERS)[number];
  let providers = $state<Record<Provider, boolean>>({ claude: true, codex: true, cursor: true });

  let METRIC_LABELS = $derived<Partial<Record<SeriesMetric, string>>>({
    inputNew: t('metric_inputNew'),
    output: t('metric_output'),
    inout: t('metric_inout'),
    cached: t('metric_cached'),
    credits: t('metric_credits'),
    quota7d: t('metric_quota'),
    sessions: t('metric_sessions'),
  });

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
          const d = await fetch(`${base}/published-daily.json`);
          if (d.ok) dailyRows = (await d.json()) as WeeklyAggregation[];
        } catch {
          /* daily optional */
        }
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

  // Codex sessions by local surface (cli / vscode / exec) over the window.
  let surfaces = $derived.by<Record<string, number>>(() => {
    const s: Record<string, number> = {};
    for (const r of displayRows) {
      for (const [k, v] of Object.entries(r.sessionsBySurface ?? {})) {
        if (k === 'cursor') continue; // cursor is its own tool row
        s[k] = (s[k] ?? 0) + v;
      }
    }
    return s;
  });

  // --- Time-series data for the chart ---
  // Windows ≤ DAILY_MAX_DAYS use daily buckets. In API mode `rows` already comes
  // daily (the CLI auto-resolves); in published mode we read the daily snapshot.
  let isDaily = $derived(sinceDays <= DAILY_MAX_DAYS);
  let chartRows = $derived.by<WeeklyAggregation[]>(() => {
    if (!isDaily) return displayRows;
    if (!published) return displayRows; // API already returned daily rows
    if (dailyRows.length === 0) return displayRows;
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    return dailyRows.filter((r) => r.weekStart >= cutoff);
  });

  // Which providers have any data in the current window (to disable empty boxes).
  let providerHasData = $derived.by<Record<Provider, boolean>>(() => {
    const has = { claude: false, codex: false, cursor: false };
    for (const r of chartRows) if (r.tool in has) has[r.tool as Provider] = true;
    return has;
  });

  // One overlaid series per checked provider (only those with data).
  let providerSeries = $derived.by(() =>
    ALL_PROVIDERS.filter((p) => providers[p])
      .map((p) => ({
        label: p,
        color: PROVIDER_COLOR[p] ?? 'var(--st-semantic-data-category1)',
        points: periodSeries(chartRows, chartMetric, p),
      }))
      .filter((s) => s.points.length > 0),
  );

  // Sparkline values (number[]) for each summary card.
  let spark = $derived({
    sessions: periodSeries(displayRows, 'sessions', 'all').map((p) => p.y),
    tokens: periodSeries(displayRows, 'tokens', 'all').map((p) => p.y),
    credits: periodSeries(displayRows, 'credits', 'all').map((p) => p.y),
    quota: periodSeries(displayRows, 'quota7d', 'all').map((p) => p.y),
  });

  let costTotalString = $derived.by(() => {
    const parts: string[] = [];
    if (totals.codexCredits > 0) parts.push(`${totals.codexCredits.toFixed(0)} cr`);
    // Claude $ is notional (API list price), not real spend on a flat-rate Max plan.
    if (totals.claudeUsdCents > 0) parts.push(`~$${(totals.claudeUsdCents / 100).toFixed(2)}`);
    return parts.length ? parts.join(' + ') : '-';
  });

  // --- Top projects (shared raw aggregation for both the bar chart and table) ---
  let topProjects = $derived.by(() => {
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
    return [...m.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  });

  let projectBars = $derived(topProjects.map((p) => ({ label: p.cwd, value: p.tokens })));

  let projectRows = $derived.by<DataTableRow[]>(() =>
    topProjects.map((p) => ({
      id: p.cwd,
      project: p.cwd,
      repoUrl: p.url ?? '',
      sessions: p.sessions,
      tokens: fmt(p.tokens),
    })),
  );

  let projectColumns = $derived<DataTableColumn[]>([
    { key: 'project', label: t('col_project'), cell: projectCell },
    { key: 'sessions', label: t('col_sessions'), align: 'end' },
    { key: 'tokens', label: t('col_tokens'), align: 'end' },
  ]);

  // --- All aggregations table ---
  let aggRows = $derived.by<DataTableRow[]>(() =>
    displayRows.map((r, i) => ({
      // index keeps the key unique even when several local paths collapse to
      // the same public repo (e.g. a repo + its worktree) in the same bucket.
      id: `${r.weekStart}|${r.projectCwd}|${r.tool}|${r.model}|${i}`,
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

  let aggColumns = $derived<DataTableColumn[]>([
    { key: 'week', label: t('col_week'), sortable: true },
    { key: 'tool', label: t('col_tool'), cell: toolCell, sortable: true },
    { key: 'project', label: t('col_project'), cell: projectCell },
    { key: 'model', label: t('col_model'), sortable: true },
    { key: 'sessions', label: t('col_sess'), align: 'end', sortable: true },
    { key: 'turns', label: t('col_turns'), align: 'end', sortable: true },
    { key: 'input', label: t('col_in'), align: 'end' },
    { key: 'output', label: t('col_out'), align: 'end' },
    { key: 'cost', label: t('col_cost'), align: 'end' },
  ]);
</script>

{#snippet projectCell(row: DataTableRow)}
  {#if row.repoUrl}
    <a href={String(row.repoUrl)} target="_blank" rel="noreferrer noopener"><code>{row.project}</code></a>
  {:else}
    <code>{row.project}</code>
  {/if}
{/snippet}

{#snippet toolCell(row: DataTableRow)}
  <Badge tone={row.tool === 'claude' ? 'info' : row.tool === 'codex' ? 'success' : 'warning'}>
    {row.tool}
  </Badge>
{/snippet}

<h1>{t('overview_title', { n: sinceDays })}</h1>

<div class="controls">
  <Select size="sm" aria-label="Since" bind:value={sinceDays} onchange={() => load()}>
    {#each [2, 7, 14, 30, 60, 90, 180, 360] as d (d)}
      <option value={d}>{t('window_days', { n: d })}</option>
    {/each}
  </Select>
  <Button variant="secondary" size="sm" onclick={() => load()}>{t('refresh')}</Button>
</div>

{#if loading}
  <p>{t('loading')}</p>
{:else if error}
  <EmptyState
    title={t('no_data_title')}
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
        title={t('published_title')}
        message={t('published_msg', {
          at: publishedAt ? t('generated', { d: publishedAt.slice(0, 10) }) : '',
        })}
      />
    </div>
  {/if}
  <section class="cards">
    <Card>
      <div class="label">{t('sessions')}</div>
      <div class="value">{totals.sessions}</div>
      {#if spark.sessions.length > 1}<div class="spark"><Sparkline data={spark.sessions} tone="neutral" /></div>{/if}
    </Card>
    <Card>
      <div class="label">{t('turns')}</div>
      <div class="value">{totals.turns}</div>
    </Card>
    <Card>
      <div class="label">{t('input_tokens')}</div>
      <div class="value">{fmt(totals.inputTotal)}</div>
      <div class="sub">{t('cache_hit', { p: totals.cacheHit.toFixed(1) })}</div>
      {#if spark.tokens.length > 1}<div class="spark"><Sparkline data={spark.tokens} tone="neutral" /></div>{/if}
    </Card>
    <Card>
      <div class="label">{t('output_tokens')}</div>
      <div class="value">{fmt(totals.outputTotal)}</div>
    </Card>
    <Card>
      <div class="label">{t('estimated_cost')}</div>
      <div class="value">{costTotalString}</div>
      <div class="sub">{t('cost_note')}</div>
      {#if spark.credits.length > 1}<div class="spark"><Sparkline data={spark.credits} tone="neutral" /></div>{/if}
    </Card>
    <Card>
      <div class="label">{t('codex_quota_peak')}</div>
      <div class="value">{totals.peak7d.toFixed(0)}%</div>
      <div class="sub">{t('quota_sub', { p: totals.peak5h.toFixed(0) })}</div>
      {#if Object.keys(surfaces).length}
        <div class="sub">
          Codex: {(surfaces.cli ?? 0) + (surfaces.exec ?? 0)} CLI · {surfaces.vscode ?? 0} VSCode
        </div>
      {/if}
      {#if spark.quota.length > 1}<div class="spark"><Sparkline data={spark.quota} tone="warning" /></div>{/if}
    </Card>
  </section>

  <div class="section-head">
    <h2>{t('usage_over_time')}</h2>
    <div class="chart-controls">
      <Select size="sm" aria-label="Metric" bind:value={chartMetric}>
        <option value="inputNew">{t('metric_inputNew')}</option>
        <option value="output">{t('metric_output')}</option>
        <option value="inout">{t('metric_inout')}</option>
        <option value="cached">{t('metric_cached')}</option>
        <option value="credits">{t('metric_credits')}</option>
        <option value="quota7d">{t('metric_quota')}</option>
        <option value="sessions">{t('metric_sessions')}</option>
      </Select>
      <div class="providers">
        {#each ALL_PROVIDERS as p (p)}
          <label class="provider" class:disabled={!providerHasData[p]}>
            <input type="checkbox" bind:checked={providers[p]} disabled={!providerHasData[p]} />
            {p}
          </label>
        {/each}
      </div>
    </div>
  </div>
  <p class="hint">
    {t('chart_hint', {
      metric: METRIC_LABELS[chartMetric] ?? '',
      grain: isDaily ? t('per_day') : t('per_week'),
    })}
  </p>
  <div class="chart" bind:clientWidth={chartWidth}>
    {#if providerSeries.length > 0}
      <MultiLineChart series={providerSeries} width={chartWidth} height={260} valueFmt={fmt} />
    {/if}
  </div>

  <h2>{t('top_projects')}</h2>
  <div class="chart" bind:clientWidth={chartWidth}>
    {#if projectBars.length > 0}
      <BarChart
        data={projectBars}
        width={chartWidth}
        height={Math.max(160, projectBars.length * 28)}
        orientation="horizontal"
        label={t('top_projects')}
      />
    {/if}
  </div>
  <DataTable
    columns={projectColumns}
    rows={projectRows}
    size="sm"
    emptyLabel={t('no_data_window')}
  />

  <h2>{t('all_aggregations', { n: displayRows.length })}</h2>
  <DataTable
    columns={aggColumns}
    rows={aggRows}
    size="sm"
    sortable
    pageSize={25}
    emptyLabel={t('no_data_window')}
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
  .spark {
    margin-top: 8px;
    height: 36px;
  }
  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 24px;
  }
  .chart-controls {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
  }
  .providers {
    display: flex;
    gap: 12px;
  }
  .provider {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    text-transform: capitalize;
    cursor: pointer;
  }
  .provider.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .chart {
    width: 100%;
    margin: 8px 0 24px;
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
