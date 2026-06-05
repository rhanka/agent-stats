# Changelog

All notable changes to `@sentropic/agent-stats` (core + cli) are
documented here. The project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-05-28

Additive, backward-compatible release.

### Added

- **Cursor source**: parse the Cursor global SQLite store (composers +
  bubbles) — tokens/sessions/messages (no cost, Cursor hides the model).
  New `tool: 'cursor'`.
- **Codex surface labelling**: `session_start.surface` (cli / vscode /
  exec) from the rollout `originator`; weekly `sessionsBySurface`.
- **Codex model fix**: read the real model from `turn_context` (was stuck
  on the provider, so Codex cost estimated to 0).
- **Daily granularity**: `aggregateByPeriod(events, 'day'|'week')`,
  `dayStartIso`, `bucketBy`; CLI `stats --granularity day|week|auto`
  (auto → daily for windows ≤ 60 days).
- **Series helpers** (`periodSeries`) with token-component metrics
  (`inputNew` / `output` / `inout` / `cached`), cached read isolated and
  excluded from in/out.
- **Custom secret patterns**: `loadSecretPatterns(yaml)` + `clean
--secret-patterns <file>`, merged with secretlint preset-recommend.
- **Web dashboard**: usage-over-time chart (overlaid per-provider lines +
  legend + hover), sparklines, top-projects bar chart, 2→360-day window,
  standard app-shell header, FR/EN i18n, published real-usage snapshot
  (weekly + 60-day daily), GitHub Pages deploy to agent-stats.sent-tech.ca.
- **Tools & skills usage stats**: per-period `toolCallsByName` /
  `skillsByName`, surfaced as Top-tools (split Claude / Codex) and Top-skills
  tables in the CLI `report` and the web dashboard. MCP tools collapse to a
  single `mcp:{server}` bucket; deterministic top-N ordering
  (`mergeNameCounts` / `topN` / `mcpBucket` helpers).

### Fixed

- Honest cost metric: Codex in credits, Claude as notional API-equivalent
  `~$` (flat-rate Max), real rate-limit quota peak (5h / 7d) surfaced.
- **Cost accuracy**: bare model aliases (`opus` / `sonnet` / `haiku`) were
  priced at $0 — now resolved to their tier; `claude-opus-4-8` registered
  explicitly (same Opus tier as 4-7) instead of an implicit fallback.
- **Claude skills were never counted** (`skillsByName` always empty): the
  `Skill` tool now emits a `skill_invoke` from `input.skill` instead of a
  generic tool_call.
- **Codex tool double-count**: shell / patch / mcp / web_search were counted
  twice (both `*_end` event_msg and `response_item`). Tool calls are now
  counted once from `response_item` (function_call / custom_tool_call /
  web_search_call / tool_search_call) — `apply_patch` and `web_search` were
  previously missed.

## [0.1.0] — 2026-05-21

Initial public release. Read `plan.md` for the per-workpackage trail.

### Added

- **`@sentropic/agent-stats-core`** : parsers (Claude Code jsonl + Codex
  rollouts via `~/.codex/state_5.sqlite` index), unified `SessionEvent`
  schema, `collect()` async iterator, weekly aggregations with cost
  estimates split per currency (Codex credits / Claude USD cents),
  rate-card lookup, JSON storage adapter, secret cleanser (secretlint),
  heuristic anomaly detection.
- **`@sentropic/agent-stats`** (CLI, binary `agent-stats`): subcommands
  `stats` (JSON/table), `report` (Markdown weekly), `clean` (archive /
  inplace / llm-input), `anomalies` (heuristic patterns).
- GitHub Actions CI (format / lint / typecheck / test+coverage) and
  release workflow (publish on `vX.Y.Z` tag with provenance + GitHub
  release notes).
- 63 Vitest tests across both packages.

### Deferred

- WP6 — custom Sentropic secret patterns yaml (preset-recommend is
  sufficient for MVP).
- WP7 — LLM-driven qualitative analysis via `@sentropic/llm-mesh`.
- WP8 — SvelteKit local dashboard.
