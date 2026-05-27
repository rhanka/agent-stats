# Design — Cursor source + Codex surface labelling

Date: 2026-05-27 · Status: approved · Scope: core parser + collect + web

## Goal

Ingest **Cursor** chat/composer history so agent-stats covers all _local_ AI
coding usage, and label **Codex** sessions by surface (CLI vs VSCode vs exec).

## Discovery (facts on this machine)

- **Codex VSCode is already ingested**: rollouts in `~/.codex/sessions` carry
  `originator` ∈ {`codex-tui` 1599, `codex_cli_rs` 213, `codex_vscode` 73,
  `codex_exec` 31, `Claude Code` 19}. The VSCode extension writes to the same
  store as the CLI, so its sessions are already in the totals — only the
  surface label is missing.
- **Cursor** stores history in `~/.config/Cursor/User/{globalStorage,
workspaceStorage/*}/state.vscdb` (38 SQLite DBs). Table `cursorDiskKV` holds
  `composerData:<id>` (sessions, with `createdAt` ms, `usageData`,
  `fullConversationHeadersOnly`) and `bubbleId:<composerId>:<bubbleId>`
  (messages, with `inputTokens`, `outputTokens`, `tokenCount`). 319 composers /
  146k messages, spanning **2025-04-30 → 2026-04-08**.
- Codex cloud (ChatGPT web, Dec–Jan) is server-side only → out of scope.

## Constraints

- Cursor exposes **no model** per message and bills in server-side "requests",
  so **no cost / credits / quota** for Cursor — only tokens, sessions, messages.
- The Cursor SQLite schema is undocumented → read-only, defensive parsing,
  tolerate missing keys; it may break on Cursor updates (acceptable).

## Design

### 1. Schema (`packages/core/src/schema.ts`)

- `Tool`: `'claude' | 'codex'` → add `'cursor'`.
- `session_start` gains optional `surface?: 'cli' | 'vscode' | 'exec' | 'cursor'`.

### 2. Cursor parser (`packages/core/src/parsers/cursor.ts`)

- `indexCursorSessions({ cursorStateDir? })`: enumerate the 38 vscdb files,
  read `composerData:*`, **dedup by `composerId`** (prefer the entry with the
  most bubbles / latest update), resolve the project from the owning
  workspace's `workspace.json` `folder` → path → public repo (reuse the repo
  resolution used by the publish pipeline where relevant).
- `parseCursorComposer()`: emit `session_start` (tool=`cursor`,
  surface=`cursor`, ts=`createdAt`), then per bubble in conversation order a
  `user_prompt` (user bubbles, hashed text) or `turn` (assistant bubbles, usage
  from `inputTokens`/`outputTokens`; cached/cacheWrite/reasoning = 0; model
  `unknown`), then `session_end`. Guard every field access.

### 3. collect (`packages/core/src/collect.ts`)

- Add a `cursor` source alongside claude/codex; new option `cursorStateDir?`
  (defaults to `~/.config/Cursor/User`). `sources` gains `cursor?: boolean`.

### 4. Codex surface (`packages/core/src/parsers/codex.ts` + aggregations)

- Map `originator` → `surface` on `session_start`
  (`codex-tui|codex_cli_rs|codex_exec → cli/exec`, `codex_vscode → vscode`).
- Aggregation adds `sessionsBySurface: Record<string, number>` (like
  `toolCallsByName`) — **no extra grouping dimension**, so no row blow-up.

### 5. Rate card / cost

- No change needed: `resolveRates` returns nothing for Cursor's `unknown`
  model, so `estimateCost` already yields `unknown`/0. Cursor rows show tokens,
  no credits/$.

### 6. Web (`packages/web`)

- Handle `tool='cursor'` (a third badge tone; include in the chart tool toggle
  as a `cursor` option; tokens/sessions metrics work, credits/quota stay empty).
- Show a small "Codex by surface" line where the quota card lives, or in the
  banner (cheap, optional).
- Regenerate the published snapshot (now spanning back to Apr 2025).

## Testing

- `cursor.test.ts`: build an in-memory `state.vscdb` (better-sqlite3, as the
  Codex test does) with composers + bubbles across two workspaces; assert
  dedup, project mapping, token sums, event order.
- Codex surface: extend `codex.test.ts` fixture with a `codex_vscode`
  originator; assert `surface` on `session_start` and `sessionsBySurface`.
- `typecheck` 0 errors, full vitest green, web build OK.

## Out of scope (YAGNI)

Message content extraction (counts/tokens only, consistent with prompt
hashing); Cursor cost/quota; Codex cloud; per-surface row grouping.
