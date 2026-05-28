<script lang="ts">
  // Small overlaid multi-series line chart (the DS LineChart is single-series).
  // All series share one x-axis (the sorted union of their x labels) and one
  // y-axis; a legend maps colour → label; hovering shows per-series values.
  type Point = { x: string; y: number };
  type Series = { label: string; color: string; points: Point[] };

  let {
    series,
    width = 900,
    height = 260,
    valueFmt = (n: number) => String(n),
  }: {
    series: Series[];
    width?: number;
    height?: number;
    valueFmt?: (n: number) => string;
  } = $props();

  const padL = 56;
  const padR = 12;
  const padT = 10;
  const padB = 24;

  let domain = $derived(
    [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  let xIndex = $derived(new Map(domain.map((x, i) => [x, i])));
  // value-at-x lookup per series, for the hover tooltip.
  let valueAt = $derived(series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))));
  let maxY = $derived(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y))));

  let plotW = $derived(Math.max(1, width - padL - padR));
  let plotH = $derived(Math.max(1, height - padT - padB));

  const xPos = (x: string): number =>
    domain.length <= 1 ? padL : padL + ((xIndex.get(x) ?? 0) / (domain.length - 1)) * plotW;
  const yPos = (y: number): number => padT + plotH - (y / maxY) * plotH;

  let paths = $derived(
    series.map((s) => ({
      color: s.color,
      d: s.points
        .slice()
        .sort((a, b) => a.x.localeCompare(b.x))
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(p.x).toFixed(1)},${yPos(p.y).toFixed(1)}`)
        .join(' '),
      dots: s.points.map((p) => ({ cx: xPos(p.x), cy: yPos(p.y) })),
    })),
  );

  let yTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxY * f, y: yPos(maxY * f) })));
  let xTicks = $derived.by(() => {
    if (domain.length === 0) return [];
    const step = Math.max(1, Math.ceil(domain.length / 6));
    return domain
      .filter((_, i) => i % step === 0 || i === domain.length - 1)
      .map((x) => ({ x, px: xPos(x) }));
  });

  // --- hover ---
  let hoverIdx = $state<number | null>(null);
  function onMove(e: MouseEvent): void {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * width; // account for CSS scaling
    if (domain.length === 0) return;
    const i = Math.round(((mx - padL) / plotW) * (domain.length - 1));
    hoverIdx = Math.max(0, Math.min(domain.length - 1, i));
  }
  let hoverX = $derived(hoverIdx === null ? null : domain[hoverIdx]);
  let hoverPx = $derived(hoverX == null ? 0 : xPos(hoverX));
  let hoverRows = $derived(
    hoverX == null
      ? []
      : series
          .map((s, i) => ({ label: s.label, color: s.color, y: valueAt[i]?.get(hoverX) }))
          .filter((r) => r.y !== undefined),
  );
  // tooltip on the left or right of the guide depending on space
  let tipRight = $derived(hoverPx < width * 0.6);
</script>

<div class="wrap" style="width:{width}px;max-width:100%">
  <svg
    {width}
    {height}
    role="img"
    aria-label="Usage over time by provider"
    onmousemove={onMove}
    onmouseleave={() => (hoverIdx = null)}
  >
    {#each yTicks as t (t.v)}
      <line x1={padL} y1={t.y} x2={width - padR} y2={t.y} class="grid" />
      <text x={padL - 8} y={t.y + 3} class="ytick" text-anchor="end">{valueFmt(t.v)}</text>
    {/each}
    {#each xTicks as t (t.x)}
      <text x={t.px} y={height - 6} class="xtick" text-anchor="middle">{t.x.slice(5)}</text>
    {/each}
    {#if hoverX != null}
      <line x1={hoverPx} y1={padT} x2={hoverPx} y2={padT + plotH} class="guide" />
    {/if}
    {#each paths as p, i (i)}
      <path d={p.d} fill="none" stroke={p.color} stroke-width="2" />
      {#each p.dots as dt (dt.cx)}<circle cx={dt.cx} cy={dt.cy} r="2" fill={p.color} />{/each}
    {/each}
    {#each hoverRows as r (r.label)}
      <circle cx={hoverPx} cy={yPos(r.y ?? 0)} r="4" fill={r.color} stroke="#fff" stroke-width="1" />
    {/each}
  </svg>
  {#if hoverX != null && hoverRows.length}
    <div
      class="tip"
      style="left:{tipRight ? hoverPx + 10 : hoverPx - 10}px;transform:translateX({tipRight
        ? '0'
        : '-100%'})"
    >
      <div class="tip-x">{hoverX}</div>
      {#each hoverRows as r (r.label)}
        <div class="tip-row">
          <span class="swatch" style="background:{r.color}"></span>{r.label}: {valueFmt(r.y ?? 0)}
        </div>
      {/each}
    </div>
  {/if}
</div>
<div class="legend">
  {#each series as s (s.label)}
    <span class="item"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
  {/each}
</div>

<style>
  .wrap {
    position: relative;
  }
  svg {
    display: block;
    max-width: 100%;
  }
  .grid {
    stroke: var(--st-semantic-border-subtle, #e2e8f0);
    stroke-width: 1;
  }
  .guide {
    stroke: var(--st-semantic-border-interactive, #94a3b8);
    stroke-dasharray: 3 3;
    stroke-width: 1;
  }
  .ytick,
  .xtick {
    fill: var(--st-semantic-text-muted, var(--st-semantic-text-secondary, #64748b));
    font-size: 11px;
  }
  .legend {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .item,
  .tip-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    text-transform: capitalize;
    color: var(--st-semantic-text-secondary, var(--st-semantic-text-primary));
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
    flex: 0 0 auto;
  }
  .tip {
    position: absolute;
    top: 8px;
    pointer-events: none;
    background: var(--st-semantic-surface-raised, #fff);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: 6px;
    padding: 6px 8px;
    box-shadow: 0 2px 8px rgb(15 23 42 / 0.12);
    white-space: nowrap;
    z-index: 2;
  }
  .tip-x {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .tip-row {
    display: flex;
  }
</style>
