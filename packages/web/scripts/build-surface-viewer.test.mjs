import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
    },
  };
}

describe('buildSurfaceViewer', () => {
  test('merges every configured graph.json and exports graphify HTML to the static surface path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repoA = makeGraph(root, 'repo-a');
    const repoB = makeGraph(root, 'repo-b');
    const mergeGraphPath = path.join(root, 'surface.json');
    const viewerHtmlPath = path.join(root, 'static', 'surface', 'graph.html');
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
        args: ['export', 'html', '--graph', mergeGraphPath, '--out', viewerHtmlPath],
      },
    ]);
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
        viewerHtmlPath: path.join(root, 'static', 'surface', 'graph.html'),
      },
      runner,
    );

    expect(runner.calls[1]).toEqual({
      file: 'graphify',
      args: [
        'export',
        'html',
        '--graph',
        path.join(root, 'surface.json'),
        '--profile',
        'surface-union',
        '--out',
        path.join(root, 'static', 'surface', 'graph.html'),
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
          viewerHtmlPath: path.join(root, 'static', 'surface', 'graph.html'),
        },
        runner,
      ),
    ).toThrow(`Missing graphify graph.json: ${path.join(repo, '.graphify', 'graph.json')}`);
    expect(runner.calls).toEqual([]);
  });

  test('wraps graphify command failures with the failed step name', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-test-'));
    const repo = makeGraph(root, 'repo-a');
    const runner = fakeRunner((_, args) => args[0] === 'export');

    expect(() =>
      buildSurfaceViewer(
        {
          cwd: root,
          graphInputs: [repo.repoDir],
          graphifyBin: 'graphify',
          mergeGraphPath: path.join(root, 'surface.json'),
          viewerHtmlPath: path.join(root, 'static', 'surface', 'graph.html'),
        },
        runner,
      ),
    ).toThrow('graphify export html failed: graphify exploded');
    expect(runner.calls).toHaveLength(2);
  });
});
