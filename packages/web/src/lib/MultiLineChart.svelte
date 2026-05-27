<script lang="ts">
  // Small overlaid multi-series line chart (the DS LineChart is single-series).
  // All series share one x-axis (the sorted union of their x labels) and one
  // y-axis; a legend maps colour → label. Y ticks use a compact formatter.
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

  // Union of x labels across all series, sorted ascending.
  let domain = $derived(
    [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  let xIndex = $derived(new Map(domain.map((x, i) => [x, i])));
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

  // 4 horizontal gridlines / y ticks.
  let yTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxY * f, y: yPos(maxY * f) })));
  // ~6 x labels, evenly spaced.
  let xTicks = $derived.by(() => {
    if (domain.length === 0) return [];
    const step = Math.max(1, Math.ceil(domain.length / 6));
    return domain.filter((_, i) => i % step === 0 || i === domain.length - 1).map((x) => ({ x, px: xPos(x) }));
  });
</script>

<svg {width} {height} role="img" aria-label="Usage over time by provider">
  {#each yTicks as t (t.v)}
    <line x1={padL} y1={t.y} x2={width - padR} y2={t.y} class="grid" />
    <text x={padL - 8} y={t.y + 3} class="ytick" text-anchor="end">{valueFmt(t.v)}</text>
  {/each}
  {#each xTicks as t (t.x)}
    <text x={t.px} y={height - 6} class="xtick" text-anchor="middle">{t.x.slice(5)}</text>
  {/each}
  {#each paths as p, i (i)}
    <path d={p.d} fill="none" stroke={p.color} stroke-width="2" />
    {#each p.dots as dt (dt.cx)}<circle cx={dt.cx} cy={dt.cy} r="2" fill={p.color} />{/each}
  {/each}
</svg>
<div class="legend">
  {#each series as s (s.label)}
    <span class="item"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
  {/each}
</div>

<style>
  svg {
    display: block;
    max-width: 100%;
  }
  .grid {
    stroke: var(--st-semantic-border-subtle, #e2e8f0);
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
  .item {
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
  }
</style>
