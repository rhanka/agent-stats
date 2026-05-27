# Design — Usage-over-time charts + 180/360-day views

Date: 2026-05-26 · Status: approved · Scope: `packages/web` only (no core/parser change)

## Goal

Add time-series visualisation of usage to the Overview dashboard, plus 180-day
and 360-day window options. Use the Sentropic design-system chart components
(published at `@sentropic/design-system-svelte@0.9.0`: `LineChart`, `AreaChart`,
`BarChart`, `Sparkline`) rather than a third-party charting lib or hand-rolled
SVG.

## Constraints (from the DS chart API)

All DS charts are **single-series**:

- `LineChart` / `AreaChart`: `data: {x: number|string, y: number}[]`, `tone`
  (`category1..8`), `smooth`, `area`, `label` (required).
- `BarChart`: `data: {label, value, tone?}[]`, `orientation` `vertical|horizontal`.
- `Sparkline`: `data: number[]`, `tone` (`neutral|success|warning|error`), `area`.

No native stacking / grouped multi-series / legend. So Claude-vs-Codex is handled
by a **tool toggle**, not overlaid series.

## Data reality

Real history only goes back to **2026-02-02** (~16 weekly buckets). 180- and
360-day views therefore show all currently-available history today; the larger
windows are future-proofing as history grows. The published snapshot is
regenerated with `--days 360` so the 360 view is backed by data.

## Features (all on the Overview page, `packages/web/src/routes/+page.svelte`)

1. **Window selector** — add `180 days` and `360 days` to the existing
   `2/7/14/30/90`. `displayRows` already filters the snapshot client-side by
   `weekStart`, so this is just two more `<option>`s. The published snapshot
   generator default moves to `--days 360`.

2. **Sparklines in the 4 summary cards** — `Sparkline` (`number[]`) of the
   weekly series for that card's metric: Sessions, Tokens (in+out), Cost
   (Codex credits), Quota peak. Tone `neutral`, except Quota peak = `warning`.

3. **"Usage over time" block** — one `LineChart` (`smooth`, tone `category1`):
   - x = `weekStart` (string, ascending), y = selected metric per week.
   - **Metric toggle**: `Tokens (in+out)` · `Codex credits` · `Quota % (7d peak)`
     · `Sessions`. Aggregation is **sum** per week, except Quota % which is the
     **max** of `rateLimitMax.secondaryPercent`.
   - **Tool toggle**: `All / Claude / Codex` — filters rows before bucketing.

4. **Top projects as `BarChart`** — horizontal, top 10, `value` = tokens
   (in+out), `label` = repo/project. The detailed "All aggregations" table
   stays below, unchanged.

## Internal design (web only)

- New helper `weeklySeries(rows, metric, tool)` in the page script (or a tiny
  `$lib/series.ts` if it grows): groups the already-filtered `displayRows` by
  `weekStart`, applies sum/max per metric, returns `{x,y}[]` ascending. Pure,
  unit-testable.
- Sparkline data reuses `weeklySeries` mapped to `number[]`.
- `BarChart` data reuses the existing `projectRows` derivation (tokens per repo),
  mapped to `{label, value}[]`.
- Charts are sized responsively: a wrapping `<div>` whose `clientWidth` is bound
  and passed as `width`; fixed `height` (~240 for the line chart, ~40 for
  sparklines, ~280 for the bar chart).

## Out of scope (YAGNI)

Stacked/multi-series charts; a separate "Trends" page; zoom/brush/tooltip
customisation; any new fields in the snapshot or core aggregations.

## Verification

- `weeklySeries` unit test (sum vs max aggregation, tool filter, ascending order).
- `typecheck` 0 errors, web `build` OK.
- Live screenshot of the deployed Overview showing sparklines + line chart +
  bar chart with the real published snapshot.
