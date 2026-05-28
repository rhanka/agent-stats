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
  /* The DS Header centers its navigation; align it left next to the title,
     matching the other Sentropic apps. Scoped under [data-st-theme] to beat
     the component's own `justify-content: center` on specificity. */
  :global([data-st-theme] .st-header__navigation) {
    justify-content: flex-start;
    gap: 16px;
    padding-left: 8px;
  }
  :global([data-st-theme] nav a) {
    color: var(--st-semantic-text-link, var(--st-semantic-text-primary));
    text-decoration: none;
    font-weight: 500;
  }
  :global([data-st-theme] nav a:hover) {
    text-decoration: underline;
  }
  /* Use the same horizontal gutter for the header and the page content so the
     title lines up with the page heading (the header is full-bleed; the body
     was a narrow centered column, which read as misaligned). */
  :global([data-st-theme] .st-header) {
    box-sizing: border-box; /* keep width:100% inclusive of the padding (no overflow) */
    padding-left: 32px;
    padding-right: 32px;
  }
  /* Full-bleed like the DS header (same 32px gutter), so the header bar and the
     page content share the exact same left/right edges at any screen width. */
  main {
    max-width: none;
    margin: 0;
    padding: 32px;
  }
</style>
