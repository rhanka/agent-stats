<script lang="ts">
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
</script>

<h1>Anomalies — last {sinceDays} days</h1>

<div class="controls">
  <label for="since">Since:</label>
  <select id="since" bind:value={sinceDays} onchange={() => load()}>
    <option value={2}>2 days</option>
    <option value={7}>7 days</option>
    <option value={14}>14 days</option>
    <option value={30}>30 days</option>
  </select>
  <button onclick={() => load()}>Refresh</button>
</div>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <p class="error">Error: {error}</p>
{:else if items.length === 0}
  <p>No anomalies detected.</p>
{:else}
  <table>
    <thead>
      <tr><th>Severity</th><th>Type</th><th>Tool</th><th>Project</th><th>Session</th><th>Evidence</th></tr>
    </thead>
    <tbody>
      {#each items as a (a.sessionId + a.type)}
        <tr>
          <td><span class="sev sev-{a.severity}">{a.severity}</span></td>
          <td>{a.type}</td>
          <td>{a.tool}</td>
          <td><code>{a.projectCwd}</code></td>
          <td><code>{a.sessionId.slice(0, 8)}</code></td>
          <td><code>{JSON.stringify(a.evidence)}</code></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  h1 { color: #f0f6fc; }
  .controls { margin: 16px 0; }
  .controls select, .controls button {
    background: #21262d; color: #d7dde7; border: 1px solid #30363d;
    padding: 4px 10px; border-radius: 4px;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #30363d; text-align: left; font-size: 14px; }
  th { color: #8b949e; font-weight: 500; }
  code { background: #161b22; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  .sev { padding: 2px 8px; border-radius: 3px; font-size: 12px; font-weight: 500; }
  .sev-high { background: #f8514920; color: #f85149; }
  .sev-medium { background: #d2992020; color: #d29920; }
  .sev-low { background: #58a6ff20; color: #58a6ff; }
  .error { color: #f85149; }
</style>
