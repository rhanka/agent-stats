#!/usr/bin/env node
/**
 * Build the committed static Surface viewer from local graphify graphs.
 *
 * Run locally on a machine where graphify is installed and each configured
 * repo has a .graphify/graph.json file. The generated HTML is written under
 * packages/web/static/ and committed. CI does not regenerate this asset.
 *
 *   GRAPHIFY_SURFACE_GRAPHS=/path/repo-a,/path/repo-b npm run surface:viewer
 *   GRAPHIFY_BIN=/path/to/graphify node packages/web/scripts/build-surface-viewer.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const staticDir = path.resolve(here, '../static');

export const DEFAULT_VIEWER_RELATIVE_PATH = 'surface/graph.html';

function splitList(value) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function readStringArrayConfig(configFile, cwd = process.cwd()) {
  const resolved = path.resolve(cwd, configFile);
  const parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  const values = Array.isArray(parsed) ? parsed : (parsed.graphs ?? parsed.repos);
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string')) {
    throw new Error(`Invalid surface graph config: ${resolved}`);
  }
  return values;
}

function valueArg(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

export function resolveGraphJsonPath(input, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const resolved = path.resolve(cwd, input);
  if (path.basename(resolved) === 'graph.json') return resolved;
  if (path.basename(resolved) === '.graphify') return path.join(resolved, 'graph.json');
  return path.join(resolved, '.graphify', 'graph.json');
}

export function createSurfaceViewerPlan(options) {
  const cwd = options.cwd ?? process.cwd();
  const fileExists = options.fileExists ?? existsSync;
  const graphInputs = options.graphInputs ?? [];
  const graphifyBin = options.graphifyBin ?? 'graphify';
  const viewerHtmlPath =
    options.viewerHtmlPath ?? path.join(staticDir, DEFAULT_VIEWER_RELATIVE_PATH);
  const mergeGraphPath = options.mergeGraphPath ?? path.join(tmpdir(), 'surface.json');

  if (graphInputs.length === 0) {
    throw new Error(
      'No graphify graphs configured. Set GRAPHIFY_SURFACE_GRAPHS=repoA,repoB or pass --graphs repoA,repoB.',
    );
  }

  const graphJsonPaths = graphInputs.map((input) => resolveGraphJsonPath(input, { cwd }));
  const missing = graphJsonPaths.filter((graphJson) => !fileExists(graphJson));
  if (missing.length > 0) {
    throw new Error(`Missing graphify graph.json: ${missing.join(', ')}`);
  }

  const mergeArgs = ['merge-graphs', ...graphJsonPaths, '--out', mergeGraphPath];
  const exportArgs = ['export', 'html', '--graph', mergeGraphPath];
  if (options.profile) exportArgs.push('--profile', options.profile);
  exportArgs.push('--out', viewerHtmlPath);

  return {
    graphifyBin,
    graphJsonPaths,
    mergeArgs,
    exportArgs,
    mergeGraphPath,
    viewerHtmlPath,
  };
}

function runStep(runner, file, args, label) {
  try {
    runner.run(file, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`, { cause: error });
  }
}

export function buildSurfaceViewer(options, runner) {
  const plan = createSurfaceViewerPlan(options);
  runStep(runner, plan.graphifyBin, plan.mergeArgs, 'graphify merge-graphs');
  runStep(runner, plan.graphifyBin, plan.exportArgs, 'graphify export html');
  return plan;
}

function graphInputsFromCli(args, env, cwd) {
  const graphs = valueArg(args, '--graphs') ?? env.GRAPHIFY_SURFACE_GRAPHS;
  if (graphs) return splitList(graphs);

  const configFile = valueArg(args, '--config') ?? env.GRAPHIFY_SURFACE_CONFIG;
  if (configFile) return readStringArrayConfig(configFile, cwd);

  const defaultConfig = path.join(cwd, 'surface.repos.json');
  if (existsSync(defaultConfig)) return readStringArrayConfig(defaultConfig, cwd);

  return [];
}

function cliOptions(args = process.argv.slice(2), env = process.env) {
  const cwd = process.cwd();
  const viewerHtmlPath = path.resolve(
    cwd,
    valueArg(args, '--out') ??
      env.GRAPHIFY_SURFACE_HTML ??
      path.relative(cwd, path.join(staticDir, DEFAULT_VIEWER_RELATIVE_PATH)),
  );
  const mergeGraphPath = path.resolve(
    cwd,
    valueArg(args, '--merge-out') ??
      env.GRAPHIFY_SURFACE_MERGED_GRAPH ??
      path.join(mkdtempSync(path.join(tmpdir(), 'agent-stats-surface-')), 'surface.json'),
  );

  return {
    cwd,
    graphInputs: graphInputsFromCli(args, env, cwd),
    graphifyBin: valueArg(args, '--graphify-bin') ?? env.GRAPHIFY_BIN ?? 'graphify',
    mergeGraphPath,
    profile: valueArg(args, '--profile') ?? env.GRAPHIFY_SURFACE_PROFILE,
    viewerHtmlPath,
  };
}

function main() {
  const options = cliOptions();
  mkdirSync(path.dirname(options.mergeGraphPath), { recursive: true });
  mkdirSync(path.dirname(options.viewerHtmlPath), { recursive: true });

  const result = buildSurfaceViewer(options, {
    run(file, args) {
      execFileSync(file, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    },
  });

  console.error(
    `Wrote Surface viewer to ${path.relative(repoRoot, result.viewerHtmlPath)} from ${result.graphJsonPaths.length} graph(s).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
