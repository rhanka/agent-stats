<script lang="ts">
  import { base } from '$app/paths';

  // Static Studio bundle produced by Graphify's current `studio export` command.
  const viewerSrc = `${base}/surface/graphify/`;

  let checked = $state(false);
  let viewerReady = $state(false);
  let detail = $state('');

  async function checkViewer(): Promise<void> {
    checked = false;
    viewerReady = false;
    detail = '';
    try {
      const res = await fetch(viewerSrc, { method: 'HEAD', cache: 'no-store' });
      viewerReady = res.ok;
      if (!res.ok) detail = `HTTP ${res.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    } finally {
      checked = true;
    }
  }

  $effect(() => {
    void checkViewer();
  });
</script>

<svelte:head>
  <title>Surface - agent-stats</title>
</svelte:head>

<section class="surface">
  <div class="heading">
    <h1>Surface</h1>
    <a class="asset-link" href={viewerSrc}>HTML graphify</a>
  </div>

  {#if viewerReady}
    <!-- sandbox without allow-same-origin: the embedded graphify export builds
         DOM via innerHTML from node labels/descriptions; isolating it to an
         opaque origin neutralizes any stored-XSS reaching the agent-stats origin.
         vis-network is pure JS (no storage), so allow-scripts is sufficient. -->
    <iframe
      class="viewer"
      title="Surface graphify"
      src={viewerSrc}
      loading="eager"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts"
    ></iframe>
  {:else}
    <div class="placeholder" role="status" aria-live="polite">
      <h2>Viewer non encore généré</h2>
      <p>Le fichier statique attendu est absent.</p>
      <code>{viewerSrc}</code>
      {#if checked && detail}
        <p class="detail">{detail}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .surface {
    min-height: calc(100vh - 104px);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  h1 {
    color: var(--st-semantic-text-primary);
  }
  h2 {
    font-size: 18px;
    color: var(--st-semantic-text-primary);
  }
  .asset-link {
    color: var(--st-semantic-text-link, #2563eb);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
  }
  .asset-link:hover {
    text-decoration: underline;
  }
  .viewer {
    width: 100%;
    min-height: calc(100vh - 176px);
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: 6px;
    background: #fff;
  }
  .placeholder {
    display: grid;
    gap: 10px;
    place-items: start;
    padding: 24px;
    border: 1px dashed var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: 6px;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-secondary, #475569);
  }
  code {
    max-width: 100%;
    overflow-wrap: anywhere;
    background: var(--st-semantic-surface-default, #fff);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 12px;
    color: var(--st-semantic-text-primary);
  }
  .detail {
    font-size: 12px;
    color: var(--st-semantic-text-muted, var(--st-semantic-text-secondary));
  }

  @media (max-width: 640px) {
    .heading {
      align-items: flex-start;
      flex-direction: column;
    }
    .viewer {
      min-height: calc(100vh - 212px);
    }
  }
</style>
