<script lang="ts">
  import {
    Select,
    Button,
    Badge,
    DataTable,
    EmptyState,
    Alert,
  } from '@sentropic/design-system-svelte';
  import type { DataTableColumn, DataTableRow } from '@sentropic/design-system-svelte';
  import { base } from '$app/paths';
  import { i18n } from '$lib/i18n.svelte';
  const t = (k: Parameters<typeof i18n.t>[0], v?: Record<string, string | number>) => i18n.t(k, v);

  type Anomaly = {
    sessionId: string;
    tool: 'claude' | 'codex' | 'cursor';
    projectCwd: string;
    type: string;
    severity: 'low' | 'medium' | 'high';
    evidence: Record<string, number | string>;
    repoUrl?: string;
  };

  let items: Anomaly[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let published = $state(false);
  let sinceDays = $state(7);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    published = false;
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await fetch(`/api/anomalies?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = (await res.json()) as Anomaly[];
    } catch (e) {
      // No live API (static public site): fall back to the published snapshot.
      try {
        const snap = await fetch(`${base}/published-anomalies.json`);
        if (!snap.ok) throw new Error(`snapshot HTTP ${snap.status}`);
        items = (await snap.json()) as Anomaly[];
        published = true;
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

  const severityTone = (s: Anomaly['severity']): 'error' | 'warning' | 'info' =>
    s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'info';

  let anomalyRows = $derived.by<DataTableRow[]>(() =>
    items.map((a, i) => ({
      id: `${a.sessionId}|${a.type}|${i}`,
      severity: a.severity,
      type: a.type,
      tool: a.tool,
      project: a.projectCwd,
      repoUrl: a.repoUrl ?? '',
      session: a.sessionId.slice(0, 8),
      evidence: JSON.stringify(a.evidence),
    })),
  );

  let columns = $derived<DataTableColumn[]>([
    { key: 'severity', label: t('col_severity'), cell: severityCell, sortable: true },
    { key: 'type', label: t('col_type'), sortable: true },
    { key: 'tool', label: t('col_tool'), cell: toolCell, sortable: true },
    { key: 'project', label: t('col_project'), cell: projectCell },
    { key: 'session', label: t('col_session'), cell: monoCell },
    { key: 'evidence', label: t('col_evidence'), cell: monoCell },
  ]);
</script>

{#snippet severityCell(row: DataTableRow)}
  <Badge tone={severityTone(row.severity as Anomaly['severity'])}>{row.severity}</Badge>
{/snippet}

{#snippet toolCell(row: DataTableRow)}
  <Badge tone={row.tool === 'claude' ? 'info' : row.tool === 'codex' ? 'success' : 'warning'}>
    {row.tool}
  </Badge>
{/snippet}

{#snippet monoCell(row: DataTableRow, col: DataTableColumn)}
  <code>{row[col.key]}</code>
{/snippet}

{#snippet projectCell(row: DataTableRow)}
  {#if row.repoUrl}
    <a href={String(row.repoUrl)} target="_blank" rel="noreferrer noopener"><code>{row.project}</code></a>
  {:else}
    <code>{row.project}</code>
  {/if}
{/snippet}

<h1>{t('anomalies_title', { n: sinceDays })}</h1>

<div class="controls">
  <Select size="sm" aria-label="Since" bind:value={sinceDays} onchange={() => load()}>
    {#each [2, 7, 14, 30] as d (d)}
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
    message="Anomaly detection runs against your local sessions through a small API. The static site has no backend, so there is nothing to show here. Run it locally to analyze your own data."
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
        message={t('published_msg', { at: '' })}
      />
    </div>
  {/if}
  <DataTable
    {columns}
    rows={anomalyRows}
    size="sm"
    sortable
    emptyLabel={t('no_anomalies')}
  />
{/if}

<style>
  h1 {
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
