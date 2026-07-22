import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { buildSurfaceViewer } from './build-surface-viewer.mjs';

function makeGraph(root, repoName) {
  const graphDir = path.join(root, repoName, '.graphify');
  mkdirSync(graphDir, { recursive: true });
  const graphJson = path.join(graphDir, 'graph.json');
  writeFileSync(graphJson, '{"nodes":[],"edges":[]}');
  return { repoDir: path.join(root, repoName), graphJson };
}

function fakeRunner(failWhen) {
  const calls = [];
  return {
    calls,
    run(file, args) {
      calls.push({ file, args });
      if (failWhen?.(file, args)) throw new Error('graphify exploded');
      // Emulate graphify merge-graphs producing the requested graph file so
      // buildSurfaceViewer can stage it as Studio state.
      if (args[0] === 'merge-graphs') {
        const out = args[args.indexOf('--out') + 1];
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, '{"nodes":[],"links":[]}');
      }
    },
  };
}

describe('buildSurfaceViewer', () => {
  test('merges every configured graph.json and exports a Graphify Studio bundle to the static surface path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repoA = makeGraph(root, 'repo-a');
    const repoB = makeGraph(root, 'repo-b');
    const mergeGraphPath = path.join(root, 'surface.json');
    const viewerHtmlPath = path.join(root, 'static', 'surface', 'graphify');
    const runner = fakeRunner();

    const result = buildSurfaceViewer(
      {
        cwd: root,
        graphInputs: [repoA.repoDir, repoB.graphJson],
        graphifyBin: 'graphify-dev',
        mergeGraphPath,
        viewerHtmlPath,
      },
      runner,
    );

    expect(result.graphJsonPaths).toEqual([repoA.graphJson, repoB.graphJson]);
    expect(runner.calls).toEqual([
      {
        file: 'graphify-dev',
        args: ['merge-graphs', repoA.graphJson, repoB.graphJson, '--out', mergeGraphPath],
      },
      {
        file: 'graphify-dev',
        args: ['studio', 'export', viewerHtmlPath, '--state', path.join(root, 'surface-state')],
      },
    ]);
    expect(result.studioGraphPath).toBe(path.join(root, 'surface-state', 'graph.json'));
    expect(existsSync(result.studioGraphPath)).toBe(true);
  });

  test('supports passing a .graphify directory and an export profile', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repo = makeGraph(root, 'repo-a');
    const runner = fakeRunner();

    buildSurfaceViewer(
      {
        cwd: root,
        graphInputs: [path.join(repo.repoDir, '.graphify')],
        graphifyBin: 'graphify',
        mergeGraphPath: path.join(root, 'surface.json'),
        profile: 'surface-union',
        viewerHtmlPath: path.join(root, 'static', 'surface', 'graphify'),
      },
      runner,
    );

    expect(runner.calls[1]).toEqual({
      file: 'graphify',
      args: [
        'studio',
        'export',
        path.join(root, 'static', 'surface', 'graphify'),
        '--state',
        path.join(root, 'surface-state'),
        '--profile',
        'surface-union',
      ],
    });
  });

  test('throws a clear error and skips graphify when a configured graph.json is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repo = path.join(root, 'missing-repo');
    const runner = fakeRunner();

    expect(() =>
      buildSurfaceViewer(
        {
          cwd: root,
          graphInputs: [repo],
          graphifyBin: 'graphify',
          mergeGraphPath: path.join(root, 'surface.json'),
          viewerHtmlPath: path.join(root, 'static', 'surface', 'graphify'),
        },
        runner,
      ),
    ).toThrow(`Missing graphify graph.json: ${path.join(repo, '.graphify', 'graph.json')}`);
    expect(runner.calls).toEqual([]);
  });

  test('wraps graphify command failures with the failed step name', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repo = makeGraph(root, 'repo-a');
    const runner = fakeRunner((_, args) => args[0] === 'studio');

    expect(() =>
      buildSurfaceViewer(
        {
          cwd: root,
          graphInputs: [repo.repoDir],
          graphifyBin: 'graphify',
          mergeGraphPath: path.join(root, 'surface.json'),
          viewerHtmlPath: path.join(root, 'static', 'surface', 'graphify'),
        },
        runner,
      ),
    ).toThrow('graphify studio export failed: graphify exploded');
    expect(runner.calls).toHaveLength(2);
  });
});
