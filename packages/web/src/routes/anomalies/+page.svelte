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

  type Anomaly = {
    sessionId: string;
    tool: 'claude' | 'codex';
    projectCwd: string;
    type: string;
    severity: 'low' | 'medium' | 'high';
    evidence: Record<string, number | string>;
  };

  let items: Anomaly[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let demo = $state(false);
  let sinceDays = $state(7);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    demo = false;
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await fetch(`/api/anomalies?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = (await res.json()) as Anomaly[];
    } catch (e) {
      // No live API (static public site): fall back to bundled demo data.
      try {
        const demoRes = await fetch(`${base}/demo-anomalies.json`);
        if (!demoRes.ok) throw new Error(`demo HTTP ${demoRes.status}`);
        items = (await demoRes.json()) as Anomaly[];
        demo = true;
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
    items.map((a) => ({
      id: a.sessionId + a.type,
      severity: a.severity,
      type: a.type,
      tool: a.tool,
      project: a.projectCwd,
      session: a.sessionId.slice(0, 8),
      evidence: JSON.stringify(a.evidence),
    })),
  );

  const columns: DataTableColumn[] = [
    { key: 'severity', label: 'Severity', cell: severityCell, sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    { key: 'tool', label: 'Tool', cell: toolCell, sortable: true },
    { key: 'project', label: 'Project', cell: monoCell },
    { key: 'session', label: 'Session', cell: monoCell },
    { key: 'evidence', label: 'Evidence', cell: monoCell },
  ];
</script>

{#snippet severityCell(row: DataTableRow)}
  <Badge tone={severityTone(row.severity as Anomaly['severity'])}>{row.severity}</Badge>
{/snippet}

{#snippet toolCell(row: DataTableRow)}
  <Badge tone={row.tool === 'claude' ? 'info' : 'success'}>{row.tool}</Badge>
{/snippet}

{#snippet monoCell(row: DataTableRow, col: DataTableColumn)}
  <code>{row[col.key]}</code>
{/snippet}

<h1>Anomalies — last {sinceDays} days</h1>

<div class="controls">
  <Select size="sm" aria-label="Since" bind:value={sinceDays} onchange={() => load()}>
    <option value={2}>2 days</option>
    <option value={7}>7 days</option>
    <option value={14}>14 days</option>
    <option value={30}>30 days</option>
  </Select>
  <Button variant="secondary" size="sm" onclick={() => load()}>Refresh</Button>
</div>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <EmptyState
    title="No live data"
    message="Anomaly detection runs against your local sessions through a small API. The static site has no backend, so there is nothing to show here. Run it locally to analyze your own data."
  >
    {#snippet action()}
      <code>npx @sentropic/agent-stats web</code>
      <p class="hint">then open http://127.0.0.1:4173 — detail: {error}</p>
    {/snippet}
  </EmptyState>
{:else}
  {#if demo}
    <div class="banner">
      <Alert
        tone="info"
        title="Demo data"
        message="This is an anonymized sample dataset. Run `npx @sentropic/agent-stats web` locally to analyze your own sessions."
      />
    </div>
  {/if}
  <DataTable
    {columns}
    rows={anomalyRows}
    size="sm"
    sortable
    emptyLabel="No anomalies detected."
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
  .hint {
    font-size: 12px;
    color: var(--st-semantic-text-muted, var(--st-semantic-text-secondary));
    margin-top: 8px;
  }
</style>
