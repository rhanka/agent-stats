<script lang="ts">
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
  };

  let rows: WeeklyAggregation[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  // Default: last 7 days.
  let sinceDays = $state(7);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await fetch(`/api/stats?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = (await res.json()) as WeeklyAggregation[];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
      parts.push(`$${(r.estimatedCost.claudeUsdCents / 100).toFixed(2)}`);
    }
    return parts.length ? parts.join(' + ') : '-';
  }

  let totals = $derived.by(() => {
    let sessions = 0;
    let turns = 0;
    let inputTotal = 0;
    let outputTotal = 0;
    let cached = 0;
    let codexCredits = 0;
    let claudeUsdCents = 0;
    for (const r of rows) {
      sessions += r.sessions;
      turns += r.turns;
      inputTotal += totalInput(r);
      outputTotal += r.totalUsage.outputTokens;
      cached += r.totalUsage.cachedInputTokens;
      codexCredits += r.estimatedCost.codexCredits;
      claudeUsdCents += r.estimatedCost.claudeUsdCents;
    }
    const cacheHit = inputTotal > 0 ? (cached / inputTotal) * 100 : 0;
    return { sessions, turns, inputTotal, outputTotal, cached, cacheHit, codexCredits, claudeUsdCents };
  });

  let topProjects = $derived.by(() => {
    const m = new Map<string, { cwd: string; tokens: number; sessions: number }>();
    for (const r of rows) {
      let acc = m.get(r.projectCwd);
      if (!acc) {
        acc = { cwd: r.projectCwd, tokens: 0, sessions: 0 };
        m.set(r.projectCwd, acc);
      }
      acc.tokens += totalInput(r) + r.totalUsage.outputTokens;
      acc.sessions += r.sessions;
    }
    return [...m.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  });
</script>

<h1>Overview — last {sinceDays} days</h1>

<div class="controls">
  <label for="since">Since:</label>
  <select id="since" bind:value={sinceDays} onchange={() => load()}>
    <option value={2}>2 days</option>
    <option value={7}>7 days</option>
    <option value={14}>14 days</option>
    <option value={30}>30 days</option>
    <option value={90}>90 days</option>
  </select>
  <button onclick={() => load()}>Refresh</button>
</div>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <p class="error">Error: {error}</p>
{:else}
  <section class="cards">
    <div class="card">
      <div class="label">Sessions</div>
      <div class="value">{totals.sessions}</div>
    </div>
    <div class="card">
      <div class="label">Turns</div>
      <div class="value">{totals.turns}</div>
    </div>
    <div class="card">
      <div class="label">Input tokens</div>
      <div class="value">{fmt(totals.inputTotal)}</div>
      <div class="sub">{totals.cacheHit.toFixed(1)}% cache hit</div>
    </div>
    <div class="card">
      <div class="label">Output tokens</div>
      <div class="value">{fmt(totals.outputTotal)}</div>
    </div>
    <div class="card">
      <div class="label">Estimated cost</div>
      <div class="value">
        {#if totals.codexCredits > 0 || totals.claudeUsdCents > 0}
          {#if totals.codexCredits > 0}{totals.codexCredits.toFixed(0)} cr{/if}
          {#if totals.codexCredits > 0 && totals.claudeUsdCents > 0} + {/if}
          {#if totals.claudeUsdCents > 0}${(totals.claudeUsdCents / 100).toFixed(2)}{/if}
        {:else}-{/if}
      </div>
    </div>
  </section>

  <h2>Top projects</h2>
  <table>
    <thead>
      <tr><th>Project</th><th>Sessions</th><th>Tokens (in+out)</th></tr>
    </thead>
    <tbody>
      {#each topProjects as p (p.cwd)}
        <tr><td><code>{p.cwd}</code></td><td>{p.sessions}</td><td>{fmt(p.tokens)}</td></tr>
      {/each}
      {#if topProjects.length === 0}
        <tr><td colspan="3">No data in this window.</td></tr>
      {/if}
    </tbody>
  </table>

  <h2>All aggregations ({rows.length} rows)</h2>
  <table>
    <thead>
      <tr>
        <th>Week</th><th>Tool</th><th>Project</th><th>Model</th>
        <th>Sess</th><th>Turns</th><th>In</th><th>Out</th><th>Cost</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.weekStart + r.projectCwd + r.tool + r.model)}
        <tr>
          <td>{r.weekStart}</td>
          <td>{r.tool}</td>
          <td><code>{r.projectCwd}</code></td>
          <td>{r.model}</td>
          <td>{r.sessions}</td>
          <td>{r.turns}</td>
          <td>{fmt(totalInput(r))}</td>
          <td>{fmt(r.totalUsage.outputTokens)}</td>
          <td>{costString(r)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  h1, h2 { color: #f0f6fc; }
  .controls { margin: 16px 0; }
  .controls label { margin-right: 8px; }
  .controls select, .controls button {
    background: #21262d; color: #d7dde7; border: 1px solid #30363d;
    padding: 4px 10px; border-radius: 4px;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; }
  .card .label { font-size: 12px; color: #8b949e; }
  .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  .card .sub { font-size: 11px; color: #58a6ff; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #30363d; text-align: left; font-size: 14px; }
  th { color: #8b949e; font-weight: 500; }
  code { background: #161b22; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  .error { color: #f85149; }
</style>
