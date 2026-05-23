import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Pages base path is purely env-driven so we can host the same build
// under any sub-path (e.g. /agent-stats/ on github.io) or root (custom
// domain). Never hardcoded in the lib.
const basePath = process.env.PAGES_BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // SPA mode so non-prerendered routes work
      precompress: false,
      strict: false,
    }),
    paths: {
      base: basePath,
      relative: false,
    },
  },
};

export default config;
