import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { startWebServer, type StartedWebServer } from './web.js';

describe('startWebServer', () => {
  let server: StartedWebServer | null = null;
  let tmpDir: string;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves a static file from the web build dir', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-web-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><title>ok</title>');
    server = await startWebServer({ port: 0, webDir: tmpDir });
    const res = await fetch(`${server.url}index.html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<title>ok</title>');
  });

  it('falls back to index.html for unknown SPA routes', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-web-'));
    writeFileSync(path.join(tmpDir, 'index.html'), 'SPA-FALLBACK');
    server = await startWebServer({ port: 0, webDir: tmpDir });
    const res = await fetch(`${server.url}anomalies`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SPA-FALLBACK');
  });

  it('serves /api/stats as JSON', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-web-'));
    writeFileSync(path.join(tmpDir, 'index.html'), '');
    const emptyClaude = path.join(tmpDir, 'empty-claude');
    mkdirSync(emptyClaude, { recursive: true });
    server = await startWebServer({
      port: 0,
      webDir: tmpDir,
      claudeProjectsDir: emptyClaude,
      codexDbPath: path.join(tmpDir, 'no.sqlite'),
    });
    const res = await fetch(`${server.url}api/stats?since=2026-05-01`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  it('serves /api/anomalies as JSON', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-web-'));
    writeFileSync(path.join(tmpDir, 'index.html'), '');
    const emptyClaude = path.join(tmpDir, 'empty-claude');
    mkdirSync(emptyClaude, { recursive: true });
    server = await startWebServer({
      port: 0,
      webDir: tmpDir,
      claudeProjectsDir: emptyClaude,
      codexDbPath: path.join(tmpDir, 'no.sqlite'),
    });
    const res = await fetch(`${server.url}api/anomalies?since=2026-05-01`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  it('returns 404 for unknown /api routes', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-web-'));
    writeFileSync(path.join(tmpDir, 'index.html'), '');
    server = await startWebServer({ port: 0, webDir: tmpDir });
    const res = await fetch(`${server.url}api/nope`);
    expect(res.status).toBe(404);
  });
});
