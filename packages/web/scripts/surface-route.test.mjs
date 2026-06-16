import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);

async function renderRoute(source) {
  const internalServer = pathToFileURL(require.resolve('svelte/internal/server')).href;
  const compiled = compile(source, {
    filename: 'packages/web/src/routes/surface/+page.svelte',
    generate: 'server',
  });
  const js = compiled.js.code.replace("from 'svelte/internal/server'", `from '${internalServer}'`);
  const module = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  return render(module.default).html;
}

describe('surface route', () => {
  test('renders the missing-viewer placeholder while still targeting the graphify HTML asset', async () => {
    const source = readFileSync(
      new URL('../src/routes/surface/+page.svelte', import.meta.url),
      'utf8',
    ).replace("import { base } from '$app/paths';", "const base = '/agent-stats';");

    const html = await renderRoute(source);

    expect(source).toContain('<iframe');
    expect(source).toContain('viewerSrc');
    expect(html).toContain('Surface');
    expect(html).toContain('Viewer non encore généré');
    expect(html).toContain('/agent-stats/surface/graph.html');
  });
});
