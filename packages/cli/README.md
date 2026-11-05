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

### `agent-stats clean`

Redact secrets in session jsonl files via `secretlint` plus the built-in
kubeconfig patterns (`packages/core/patterns/kubeconfig.yaml`).

```
agent-stats clean --input <file|dir> --mode <archive|inplace|llm-input> [options]

Options:
  --out <dir>                Output directory (archive | llm-input)
  --max-tool-result-bytes <n> Truncate strings larger than N bytes (llm-input)
  --secret-patterns <file>   YAML file of extra org-specific secret regexes
  --no-backup                Inplace: rewrite with no backup (no .bak kept)
  --backup-dir <dir>         Inplace: backups under <dir> (mode 0600)
```

### `agent-stats verify`

Check a file for leaked env-var values without exposing them: values are read
from a `.env` file through a file descriptor, only var NAMES come from argv,
and stdout carries names, counts and sha256 fingerprints only. Exits non-zero
while any count is above zero.

```
agent-stats verify --file <path> --env-file <.env> [VAR...]
```

### Roadmap

- `anomalies` — heuristic frustration / IA-out-of-control detection (WP5)
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
