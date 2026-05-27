# Design — Usage-over-time chart enrichment

Date: 2026-05-27 · Status: approved · Scope: core + cli + web publish + web UI

## Goal

Make the Overview "Usage over time" chart more useful:

1. **Metric selector**: `Input (new)` · `Output` · `In+Out` · `Cached (read)`.
2. **Cached** isolated as its own metric, **excluded** from in/out (it is mostly
   replay volume and was drowning real work).
3. **Per-provider split** via checkboxes (claude/codex/cursor) rendered as
   **small multiples** (one design-system LineChart per checked provider).
4. **Daily granularity** for windows `< 30 days` (weekly otherwise).

## Decisions (from Q/R)

- Multi-series → **small multiples** (DS LineChart is single-series; no custom
  chart code).
- Cached → **isolated, excluded** from in/out metrics.
- Daily → **hybrid snapshot**: core gains daily bucketing; local API uses daily
  for <30d; the published site reads a separate `published-daily.json` (≈ last
  60 days, daily) for <30d views. `published-stats.json` stays weekly.

## Metric definitions

| Metric     | Value                                          |
| ---------- | ---------------------------------------------- |
| `inputNew` | `newInputTokens + cacheWriteTokens`            |
| `output`   | `outputTokens + reasoningTokens`               |
| `inout`    | `inputNew + output` (**cached read excluded**) |
| `cached`   | `cachedInputTokens` (the replay, isolated)     |

(Existing sparkline metrics `tokens`/`credits`/`quota7d`/`sessions` keep their
current meaning; `tokens` stays in+cached+out for the card to match totals.)

## Core (`packages/core`)

- `WeeklyAggregation` gains `granularity?: 'day' | 'week'` (absent ⇒ `week`,
  backward-compatible with the deployed snapshot). `weekStart` holds the bucket
  start ISO date for both granularities.
- `aggregations.ts`: add `dayStartIso(ts)` and a `granularity` parameter to the
  weekly bucketing (`bucketBy(sessions, granularity)`), exposed as
  `aggregateByPeriod(events, granularity)`. `aggregateWeekly` stays as the
  `'week'` shortcut.
- `series.ts`: extend `SeriesMetric` with `inputNew | output | inout | cached`;
  `metricValue` computes per the table above. `weeklySeries` is renamed
  `periodSeries` (alias kept) and is granularity-agnostic (buckets by
  `weekStart`, already the bucket key).

## CLI (`packages/cli`)

- `runStats` gains `granularity?: 'day' | 'week' | 'auto'` (default `auto`:
  `< 30d` window ⇒ `day`, else `week`). The web API passes the window so it
  resolves correctly.

## Snapshot generator (`packages/web/scripts/build-published-data.mjs`)

- Also emit `published-daily.json`: the last ~60 days aggregated **daily**
  (same relabel + private-N anonymization as weekly). `published-stats.json`
  unchanged (weekly, full window).

## Web (`packages/web`)

- Controls: metric `<Select>` (4 token options) + provider **checkboxes**
  (claude/codex/cursor, default all checked).
- Render one `LineChart` per checked provider (small multiples), each plotting
  the selected metric; hide a provider's chart if it has < 2 points (reusing the
  existing "disappear when empty" behaviour).
- Data source by window: `sinceDays < 30` ⇒ daily rows (local `/api/stats`
  daily, or `published-daily.json`); else weekly (`/api/stats` weekly or
  `published-stats.json`). Cards/tables stay on the weekly/over-window totals.

## Testing

- core: `bucketDaily`/`aggregateByPeriod` (daily keys), `periodSeries` metric
  variants (inputNew excludes cache, cached isolated, inout excludes cache).
- web: typecheck + build; headless check that metric switch + provider
  checkboxes + <30d daily render and empty providers disappear.

## Out of scope (YAGNI)

Custom overlaid multi-line chart; stacked area; daily beyond ~60 days; daily in
the cards/tables; per-model (not per-provider) split.
