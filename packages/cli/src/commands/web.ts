/**
 * `agent-stats web` — start a tiny local HTTP server that serves the
 * static SvelteKit build (from `@sentropic/agent-stats-web`) and exposes
 * `/api/stats` + `/api/anomalies` JSON endpoints backed by `runStats` /
 * `runAnomalies`.
 *
 * Only depends on `node:http`, `node:fs/promises` and `node:path` — no
 * extra HTTP framework.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runStats } from './stats.js';
import { runAnomalies } from './anomalies.js';

export interface WebCommandOptions {
  port?: number;
  /** Override the static build dir; defaults to ../web/build relative to the CLI dist. */
  webDir?: string;
  /** Override the Claude projects dir (for tests and isolated runs). */
  claudeProjectsDir?: string;
  /** Override the Codex sqlite index path. */
  codexDbPath?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveDefaultWebDir(): string {
  // packages/cli/dist/commands/web.js → packages/web/build
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', 'web', 'build');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

async function serveStaticFile(
  res: ServerResponse,
  webDir: string,
  urlPath: string,
): Promise<void> {
  // Strip query string and normalize.
  let p = urlPath.split('?', 1)[0] ?? '/';
  if (p === '/') p = '/index.html';
  // Prevent path traversal.
  const resolved = path.normalize(path.join(webDir, p));
  if (!resolved.startsWith(webDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const s = await stat(resolved);
    if (s.isDirectory()) {
      return serveStaticFile(res, webDir, `${urlPath.replace(/\/$/, '')}/index.html`);
    }
    const content = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.statusCode = 200;
    res.setHeader('content-type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.end(content);
  } catch {
    // Fallback to SPA index.html for client-side routes.
    try {
      const fallback = path.join(webDir, 'index.html');
      const content = await readFile(fallback);
      res.statusCode = 200;
      res.setHeader('content-type', MIME_TYPES['.html']!);
      res.end(content);
    } catch {
      sendText(res, 404, 'Not Found');
    }
  }
}

function makeHandleApi(defaults: {
  claudeProjectsDir?: string;
  codexDbPath?: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const since = url.searchParams.get('since') ?? undefined;
    const until = url.searchParams.get('until') ?? undefined;
    const tool = (url.searchParams.get('tool') ?? undefined) as 'claude' | 'codex' | undefined;
    const project = url.searchParams.get('project') ?? undefined;
    const common = {
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      ...(tool ? { tool } : {}),
      ...(project ? { project } : {}),
      ...(defaults.claudeProjectsDir ? { claudeProjectsDir: defaults.claudeProjectsDir } : {}),
      ...(defaults.codexDbPath ? { codexDbPath: defaults.codexDbPath } : {}),
    };
    try {
      if (url.pathname === '/api/stats') {
        const r = await runStats(common);
        sendJson(res, 200, r.rows);
        return;
      }
      if (url.pathname === '/api/anomalies') {
        const r = await runAnomalies(common);
        sendJson(res, 200, r.anomalies);
        return;
      }
      sendJson(res, 404, { error: 'unknown api route' });
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export interface StartedWebServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(opts: WebCommandOptions = {}): Promise<StartedWebServer> {
  const port = opts.port ?? 4173;
  const webDir = opts.webDir ?? resolveDefaultWebDir();
  const handleApi = makeHandleApi({
    ...(opts.claudeProjectsDir ? { claudeProjectsDir: opts.claudeProjectsDir } : {}),
    ...(opts.codexDbPath ? { codexDbPath: opts.codexDbPath } : {}),
  });
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      void handleApi(req, res);
      return;
    }
    void serveStaticFile(res, webDir, url);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown): void => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function runWeb(opts: WebCommandOptions = {}): Promise<StartedWebServer> {
  const s = await startWebServer(opts);
  process.stdout.write(`agent-stats web running at ${s.url}\nPress Ctrl-C to stop.\n`);
  return s;
}
