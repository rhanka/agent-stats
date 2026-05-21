#!/usr/bin/env node
/**
 * agent-stats CLI entry.
 * Subcommands: stats | report. The rest (anomalies, clean, analyze, web,
 * bench) will follow in WP5-WP8.
 */

import { writeFile } from 'node:fs/promises';

import { Command } from 'commander';

import { VERSION } from '@sentropic/agent-stats-core';

import { runStats } from './commands/stats.js';
import { runReport } from './commands/report.js';
import { runClean } from './commands/clean.js';

async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('agent-stats')
    .description('Analyze Claude Code and Codex CLI sessions.')
    .version(VERSION);

  program
    .command('stats')
    .description('Compute weekly aggregations and output JSON or a compact table.')
    .option('--since <iso>', 'Lower bound (ISO 8601)')
    .option('--until <iso>', 'Upper bound (ISO 8601)')
    .option('--tool <name>', 'Restrict to one tool: claude | codex')
    .option('--project <cwd>', 'Filter by project cwd (exact or prefix with trailing /)')
    .option('--format <fmt>', 'Output format: json | table', 'json')
    .option('--out <file>', 'Write to file instead of stdout')
    .action(async (opts) => {
      const result = await runStats({
        since: opts.since,
        until: opts.until,
        tool: opts.tool,
        project: opts.project,
        format: opts.format,
      });
      if (opts.out) await writeFile(opts.out, result.output);
      else process.stdout.write(`${result.output}\n`);
    });

  program
    .command('clean')
    .description('Redact secrets in session jsonl files (via secretlint).')
    .requiredOption('--input <path>', 'File or directory to clean')
    .option('--mode <mode>', 'archive | inplace | llm-input', 'archive')
    .option('--out <dir>', 'Output directory (archive | llm-input)')
    .option(
      '--max-tool-result-bytes <n>',
      'Truncate strings larger than N bytes (llm-input mode)',
      (v) => parseInt(v, 10),
      2048,
    )
    .action(async (opts) => {
      const result = await runClean({
        input: opts.input,
        mode: opts.mode,
        out: opts.out,
        maxToolResultBytes: opts.maxToolResultBytes,
      });
      process.stdout.write(`${result.output}\n`);
    });

  program
    .command('report')
    .description('Generate a Markdown weekly report.')
    .option('--since <iso>', 'Lower bound (ISO 8601)')
    .option('--until <iso>', 'Upper bound (ISO 8601)')
    .option('--tool <name>', 'Restrict to one tool: claude | codex')
    .option('--project <cwd>', 'Filter by project cwd (exact or prefix with trailing /)')
    .option('--top <n>', 'Top-N projects / models per week', (v) => parseInt(v, 10), 10)
    .option('--out <file>', 'Write to file instead of stdout')
    .action(async (opts) => {
      const result = await runReport({
        since: opts.since,
        until: opts.until,
        tool: opts.tool,
        project: opts.project,
        top: opts.top,
      });
      if (opts.out) await writeFile(opts.out, result.output);
      else process.stdout.write(result.output);
    });

  await program.parseAsync(argv);
  return 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`agent-stats: ${msg}`);
    process.exit(1);
  });
