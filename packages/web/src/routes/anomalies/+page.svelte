<script lang="ts">
  import { Select, Button, Badge, DataTable } from '@sentropic/design-system-svelte';
  import type { DataTableColumn, DataTableRow } from '@sentropic/design-system-svelte';

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
  let sinceDays = $state(7);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await fetch(`/api/anomalies?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = (await res.json()) as Anomaly[];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
  <p class="error">Error: {error}</p>
{:else}
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
  code {
    background: var(--st-semantic-surface-subtle, var(--st-semantic-surface-raised));
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }
  .error {
    color: var(--st-semantic-status-error, #f85149);
  }
</style>
