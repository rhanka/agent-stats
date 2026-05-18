#!/usr/bin/env node
/**
 * agent-stats CLI entry. WP4 will implement subcommands:
 *   stats | report | anomalies | clean | analyze | web | bench
 */

import { VERSION } from '@sentropic/agent-stats-core';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`agent-stats ${VERSION}
Usage: agent-stats <command> [options]

Commands (WIP):
  stats        Output JSON statistics
  report       Generate weekly Markdown report
  anomalies    Detect frustration / out-of-control patterns
  clean        Redact secrets from session jsonl
  analyze      LLM-based analysis (via @sentropic/llm-mesh)
  web          Launch local dashboard
  bench        Benchmark LLM models

Run \`agent-stats <command> --help\` for details (once implemented).`);
  process.exit(0);
}

if (args[0] === '--version' || args[0] === '-v') {
  console.log(VERSION);
  process.exit(0);
}

console.error(`agent-stats: command not implemented yet: ${args[0]}`);
console.error(`See plan.md (WP4) — bootstrap phase only.`);
process.exit(1);
