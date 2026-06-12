import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Isolate from the real ~/.config/Cursor and ~/.gemini/tmp so collect() in
    // tests doesn't read the host's Cursor DB / Gemini sessions (slow +
    // non-deterministic). Each parser's own test passes an explicit dir, which
    // overrides these.
    env: {
      AGENT_STATS_CURSOR_DIR: '/nonexistent-agent-stats-cursor-test',
      AGENT_STATS_GEMINI_TMP_DIR: '/nonexistent-agent-stats-gemini-test',
    },
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'packages/*/scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Coverage targets the core + cli libraries. The web package is verified
      // by svelte-check + build; its Svelte-rune .ts (e.g. theme.svelte.ts)
      // can't be parsed by the coverage instrumenter on the CI runner.
      include: ['packages/core/src/**/*.ts', 'packages/cli/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/dist/**'],
    },
  },
});
