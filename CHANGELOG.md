# Changelog

All notable changes to `@sentropic/agent-stats` (core + cli) are
documented here. The project follows [Semantic Versioning](https://semver.org/).

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
