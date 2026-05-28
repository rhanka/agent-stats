<script lang="ts">
  import { ThemeProvider } from '@sentropic/design-system-svelte';
  import { themeState } from '$lib/theme.svelte';
  import { i18n, type Lang } from '$lib/i18n.svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';

  let { children } = $props();
  let navOpen = $state(false);

  const current = $derived($page.url.pathname.replace(base, '') || '/');
  const links = $derived([
    { href: `${base}/`, path: '/', label: i18n.t('nav_overview') },
    { href: `${base}/anomalies`, path: '/anomalies', label: i18n.t('nav_anomalies') },
  ]);
</script>

<ThemeProvider theme={themeState.theme}>
  <header class="appbar">
    <div class="bar">
      <button
        class="burger"
        aria-label="Menu"
        aria-expanded={navOpen}
        onclick={() => (navOpen = !navOpen)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"
          ><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg
        >
      </button>

      <a class="brand" href="{base}/">
        <span class="logo" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20"
            ><rect x="2" y="11" width="3.4" height="7" rx="1" /><rect x="8.3" y="6" width="3.4" height="12" rx="1" /><rect x="14.6" y="2" width="3.4" height="16" rx="1" /></svg
          >
        </span>
        agent-stats
      </a>

      <nav class="nav" class:open={navOpen} aria-label="Primary">
        {#each links as l (l.path)}
          <a href={l.href} class:active={current === l.path} onclick={() => (navOpen = false)}>{l.label}</a>
        {/each}
      </nav>

      <div class="right">
        <select
          class="ctl"
          aria-label="Language"
          value={i18n.lang}
          onchange={(e) => i18n.set((e.currentTarget as HTMLSelectElement).value as Lang)}
        >
          <option value="en">EN</option>
          <option value="fr">FR</option>
        </select>
      </div>
    </div>
  </header>

  <main>
    <div class="container">
      {@render children?.()}
    </div>
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
  :global([data-st-theme]) {
    min-height: 100vh;
    background: var(--st-semantic-surface-default);
    color: var(--st-semantic-text-primary);
  }

  .appbar {
    position: sticky;
    top: 0;
    z-index: 70;
    width: 100%;
    background: var(--st-semantic-surface-default);
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }
  /* Centered container shared by the bar and the page content → aligned. */
  .bar {
    max-width: 1280px;
    margin: 0 auto;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 24px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    font-size: 15px;
    color: var(--st-semantic-text-primary);
    text-decoration: none;
    flex: 0 0 auto;
  }
  .logo :global(svg) {
    display: block;
    fill: var(--st-semantic-text-link, var(--st-semantic-data-category1, #4e79a7));
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 auto;
  }
  .nav a {
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    color: var(--st-semantic-text-secondary, var(--st-semantic-text-primary));
  }
  .nav a:hover {
    background: var(--st-semantic-surface-subtle, #f1f5f9);
  }
  .nav a.active {
    color: var(--st-semantic-text-link, #2563eb);
    background: var(--st-semantic-surface-subtle, #eff6ff);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }
  .ctl {
    font: inherit;
    font-size: 13px;
    color: var(--st-semantic-text-primary);
    background: var(--st-semantic-surface-default);
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .burger {
    display: none;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: none;
    background: transparent;
    color: var(--st-semantic-text-primary);
    border-radius: 6px;
    cursor: pointer;
  }
  .burger:hover {
    background: var(--st-semantic-surface-subtle, #f1f5f9);
  }
  main {
    width: 100%;
  }
  .container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
  }

  /* Responsive: collapse nav behind the burger. */
  @media (max-width: 760px) {
    .burger {
      display: inline-flex;
    }
    .nav {
      position: absolute;
      top: 56px;
      left: 0;
      right: 0;
      flex-direction: column;
      align-items: stretch;
      gap: 0;
      background: var(--st-semantic-surface-default);
      border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
      padding: 8px 24px 12px;
      display: none;
    }
    .nav.open {
      display: flex;
    }
    .nav a {
      padding: 10px;
    }
  }
</style>
