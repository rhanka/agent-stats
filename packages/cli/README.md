# `@sentropic/agent-stats`

CLI for [`agent-stats`](https://github.com/rhanka/agent-stats). Reads
Claude Code and Codex CLI session jsonl files, aggregates them per week,
and emits JSON or Markdown.

## Install

```bash
npm install -g @sentropic/agent-stats
# or in a workspace
npm install --save-dev @sentropic/agent-stats
```

## Subcommands

### `agent-stats stats`

Compute weekly aggregations.

```
agent-stats stats [options]

Options:
  --since <iso>     Lower bound (ISO 8601)
  --until <iso>     Upper bound (ISO 8601)
  --tool <name>     Restrict to one tool: claude | codex
  --project <cwd>   Filter by cwd (exact, or prefix with trailing /)
  --format <fmt>    json (default) | table
  --out <file>      Write to file instead of stdout
```

Each emitted row is a `WeeklyAggregation` keyed by
`(weekStart, projectCwd, tool, model)` with: token totals (input / cached /
cacheWrite / output / reasoning), sessions / turns / durations, tool & skill
counts, sub-agent stats, cost estimates split per currency
(`codex_credits` vs `claude_usd_cents`), and max rate-limit % seen.

### `agent-stats report`

Generate a Markdown weekly report.

```
agent-stats report [options]

Options:
  --since <iso>     Lower bound (ISO 8601)
  --until <iso>     Upper bound (ISO 8601)
  --tool <name>     Restrict to one tool: claude | codex
  --project <cwd>   Filter by cwd
  --top <n>         Top-N projects / models per week (default 10)
  --out <file>      Write to file instead of stdout
```

Each week section contains: Totals (sessions, turns, tool calls,
compactions, tokens, cache-hit %, cost), Top projects, Top models.

### Roadmap

- `anomalies` — heuristic frustration / IA-out-of-control detection (WP5)
- `clean` — redact secrets in session jsonl via `secretlint` (WP6)
- `analyze` — LLM-based qualitative analysis via `@sentropic/llm-mesh` (WP7)
- `web` — launch the local SvelteKit dashboard (WP8)
- `bench` — benchmark LLM models on a labeled eval set (WP7)

See [`plan.md`](../../plan.md) for the full roadmap.

## Programmatic use

The same logic is available as a library:

```ts
import { runStats, runReport } from '@sentropic/agent-stats';

const { rows, output } = await runStats({ since: '2026-05-01', format: 'json' });
```

## License

MIT.
