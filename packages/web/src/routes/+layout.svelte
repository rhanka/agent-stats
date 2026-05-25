<script lang="ts">
  import { ThemeProvider, Header, Select } from '@sentropic/design-system-svelte';
  import { themeState, THEMES } from '$lib/theme.svelte';
  import { base } from '$app/paths';

  let { children } = $props();
</script>

<ThemeProvider theme={themeState.theme}>
  <Header title="agent-stats" label="Claude Code + Codex usage">
    {#snippet navigation()}
      <a href="{base}/">Overview</a>
      <a href="{base}/anomalies">Anomalies</a>
    {/snippet}
    {#snippet actions()}
      <Select
        size="sm"
        aria-label="Theme"
        value={themeState.id}
        onchange={(e) => themeState.set((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each Object.values(THEMES) as t (t.id)}
          <option value={t.id}>{t.label}</option>
        {/each}
      </Select>
    {/snippet}
  </Header>

  <main>
    {@render children?.()}
  </main>
</ThemeProvider>

<style>
  :global(body) {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }
  /* The ThemeProvider wrapper carries the data-st-theme attribute, so the
     semantic tokens resolve here. Fill the viewport with the theme surface. */
  :global([data-st-theme]) {
    min-height: 100vh;
    background: var(--st-semantic-surface-default);
    color: var(--st-semantic-text-primary);
  }
  :global([data-st-theme] nav a) {
    color: var(--st-semantic-text-link, var(--st-semantic-text-primary));
    margin-right: 16px;
    text-decoration: none;
    font-weight: 500;
  }
  :global([data-st-theme] nav a:hover) {
    text-decoration: underline;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
  }
</style>
