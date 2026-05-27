import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Isolate from the real ~/.config/Cursor so collect() in tests doesn't read
    // the host's Cursor DB (slow + non-deterministic). The cursor parser's own
    // test passes an explicit cursorStateDir, which overrides this.
    env: { AGENT_STATS_CURSOR_DIR: '/nonexistent-agent-stats-cursor-test' },
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      // `.d.ts` (e.g. SvelteKit's app.d.ts) and build caches can't be parsed by
      // the coverage instrumenter on some platforms — exclude them.
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/dist/**', '**/.svelte-kit/**'],
    },
  },
});
