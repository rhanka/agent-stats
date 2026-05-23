<script lang="ts">
  let { children } = $props();
</script>

<header>
  <nav>
    <a href="/">Overview</a>
    <a href="/anomalies">Anomalies</a>
  </nav>
</header>

<main>
  {@render children?.()}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    background: #0e1116;
    color: #d7dde7;
  }
  header {
    background: #161b22;
    padding: 12px 24px;
    border-bottom: 1px solid #30363d;
  }
  nav a {
    color: #58a6ff;
    margin-right: 16px;
    text-decoration: none;
    font-weight: 500;
  }
  nav a:hover {
    text-decoration: underline;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
  }
</style>
