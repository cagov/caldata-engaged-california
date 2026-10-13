<script lang="ts">
  import { onMount } from "svelte";
  import {
    computeGroupGrid,
    packSwarm,
    clusterByRank,
    type GroupCell,
    type PositionedDot,
    type SwarmItem,
  } from "../lib/swarm.ts";
  import { packSwarmAsync } from "../lib/swarmClient.ts";
  import { swarmLayoutCache } from "../lib/layoutCache.ts";
  import { wrapLabel, computeLabelBandWidths } from "../lib/labels.ts";
  import { colorsForSegment } from "../lib/palette.ts";
  import type { RespondentsData } from "../lib/data.ts";
  import DetailPanel from "./DetailPanel.svelte";
  import CategoryLegend from "./CategoryLegend.svelte";

  const R = 2.5;
  // Matches the per-dot breathing room the circle prototypes get for free
  // from filling their whole canvas (their Vogel-spiral minimum separation
  // works out to ~9px at corpus scale) — GAP=1 packed the hex lattice
  // noticeably tighter than that.
  const GAP = 3;
  // Estimated per-character width for the 11px axis-label font — no DOM
  // measurement in this pure layout path, so wrapping is based on an
  // estimate rather than exact text metrics. Chosen not to under-wrap.
  const LABEL_CHAR_WIDTH = 6;
  const LABEL_LINE_HEIGHT = 12;
  const LABEL_BAND_PADDING = 6;
  // Headroom above a row's topmost label line, so its ascent never touches
  // the chart edge (row 0) or the row above's dots (row 1+).
  const LABEL_TOP_MARGIN = 12;
  // Gap between the n= baseline and the first dot below it.
  const PLOT_TOP_GAP = 16;
  // Each row's plot height is sized to its own largest blob (see
  // geometryFor) rather than a fixed fraction of the chart — a floor keeps a
  // row of only tiny groups from collapsing to near-nothing.
  const MIN_ROW_PLOT = 60;
  // Fixed per-side buffer added to each row's largest blob radius. The hex
  // lattice's actual extent (packHexPoints) never exceeds its area-based
  // radius estimate (hexBlobRadius, swarm.ts) by more than ~2px even at the
  // worst-case group size — verified up to n=2000 — so this only needs to
  // cover that plus the dot's own visual radius (R) and a couple px of
  // breathing room before the next row's label band; it's a fixed pixel
  // amount, not a multiplier, because the estimate's error doesn't grow
  // with blob size the way a multiplier would assume.
  const ROW_PAD = 8;
  const BOTTOM_PAD = 10;
  // A visual dot at 2*R=5px is well under a comfortable pointer target, but
  // packing this dense (dots are ~5px apart center-to-center at rest) rules
  // out the usual ~24px hit area — neighboring targets would overlap almost
  // entirely. HIT_R is a proportionate compromise (~2x the visual radius);
  // a nearest-point/Voronoi hit layer would do better but is out of scope
  // for this internal tool. Keyboard access (Tab/Enter) is exact regardless.
  const HIT_R = 5;
  // ~18ms per destination group so blobs assemble left to right on a switch
  // instead of every dot crossing the chart at once.
  const STAGGER_MS = 18;
  // When clustering, unmatched dots wait a beat behind matched ones so the
  // core reads as forming first, with the rest settling around it —
  // instead of the whole blob sliding as one mass.
  const CLUSTER_UNMATCHED_DELAY_MS = 120;

  let {
    data,
    segmentIndex,
    questionIndex,
    colorIndex,
    highlightOf = null,
    highlightLabel = null,
    clusterOn = false,
    stanceIndexOf = null,
    stanceCategoryCount = 0,
    stanceGroupOn = false,
    width = 1100,
    height = 420,
  }: {
    data: RespondentsData;
    segmentIndex: number;
    questionIndex: number;
    colorIndex: number;
    /** One boolean per respondent (data.respondents order) — true if they
     * raised the picked theme on the current question. null means no
     * theme is picked, so nothing dims. Independent of colorIndex: a
     * highlight dims via opacity, never touches fill. */
    highlightOf?: boolean[] | null;
    /** The picked theme's own label — just for captioning highlightLegend
     * below, so it reads unambiguously next to the color key. */
    highlightLabel?: string | null;
    /** "Cluster matches" toggle — when on and a theme is highlighted, moves
     * every matched dot to the core of its own blob (see clusterMatched).
     * A pure permutation of the existing layout, so it's ignored entirely
     * when highlightOf is null. */
    clusterOn?: boolean;
    /** Each respondent's Stance category index (data.respondents order), or
     * null if the export has no Stance segment. Independent of colorIndex
     * and segmentIndex — this only feeds "Group by stance" below. */
    stanceIndexOf?: number[] | null;
    /** How many Stance categories exist — the fixed offset that keeps a
     * theme-match tier and a stance sub-rank from colliding when both
     * toggles are on (see computeRankOf). */
    stanceCategoryCount?: number;
    /** "Group by stance" toggle — independent of clusterOn/highlightOf: it
     * always rearranges dots within their existing blob by Stance category,
     * whether or not a theme is picked. When both this and clusterOn (with
     * a theme picked) are on, theme-match stays the primary split and
     * Stance becomes a secondary sort within each match tier. */
    stanceGroupOn?: boolean;
    width?: number;
    height?: number;
  } = $props();

  // The permutation rank fed to clusterByRank, or null when neither
  // rearrangement toggle applies (raw layout order). Theme-match is always
  // the primary key when both toggles are active — stance only breaks ties
  // within a match tier — per computeRankOf's own doc.
  const rankOf = $derived.by((): number[] | null => {
    const themeActive = clusterOn && highlightOf;
    const stanceActive = stanceGroupOn && stanceIndexOf;
    if (!themeActive && !stanceActive) return null;
    if (themeActive && stanceActive) {
      return data.respondents.map((_, i) => (highlightOf![i] ? 0 : stanceCategoryCount) + stanceIndexOf![i]);
    }
    if (themeActive) return highlightOf!.map((m) => (m ? 0 : 1));
    return stanceIndexOf!;
  });

  // segmentIndex -1 is the synthetic "All respondents" view — one group
  // holding everyone, laid out by the same generic code path as any real
  // demographic breakdown (packSwarm/computeGroupGrid don't special-case
  // groups.length === 1).
  const ALL_SEGMENT = { key: "ALL", label: "All respondents", values: ["All respondents"], rawValues: ["All respondents"] };
  function segmentFor(segIdx: number) {
    return segIdx === -1 ? ALL_SEGMENT : data.meta.segments[segIdx];
  }
  const segment = $derived(segmentFor(segmentIndex));
  const groupOf = $derived(
    segmentIndex === -1 ? data.respondents.map(() => 0) : data.respondents.map((r) => r.seg[segmentIndex]),
  );

  const counts = $derived.by(() => {
    const c = new Array(segment.values.length).fill(0);
    for (const g of groupOf) c[g]++;
    return c;
  });

  // Color is an independent axis from position — segmentIndex still drives
  // the blob layout; colorIndex only decides each dot's fill. -1 means "no
  // color" (the same sentinel CircleSwarm uses for "no breakdown").
  const colorSegment = $derived(colorIndex === -1 ? null : data.meta.segments[colorIndex]);
  const colorGroupOf = $derived(colorIndex === -1 ? null : data.respondents.map((r) => r.seg[colorIndex]));
  const colors = $derived(colorSegment ? colorsForSegment(colorSegment.key, colorSegment.values) : null);
  const colorCounts = $derived.by(() => {
    if (!colorSegment || !colorGroupOf) return null;
    const c = new Array(colorSegment.values.length).fill(0);
    for (const g of colorGroupOf) c[g]++;
    return c;
  });

  interface Geometry {
    cells: GroupCell[];
    wrappedLabels: string[][];
    rowOf: number[];
    /** Per-row n= baseline y — the same for every group in a row, so a
     * ragged label block still lands on a tidy count row. */
    nY: number[];
    svgHeight: number;
  }

  // Pure function of segIdx (+ the width/height props and module constants)
  // so it can be evaluated for any breakdown, not just the one on screen —
  // the onMount pre-warm below needs geometry (specifically, cells) for
  // every segment, not only the active one.
  function geometryFor(segIdx: number): Geometry {
    const seg = segmentFor(segIdx);
    const groups = segIdx === -1 ? data.respondents.map(() => 0) : data.respondents.map((r) => r.seg[segIdx]);
    const segCounts = new Array(seg.values.length).fill(0);
    for (const g of groups) segCounts[g]++;

    const grid = computeGroupGrid(segCounts, { width, r: R, gap: GAP });

    // Wrap each group's label within the space actually available to it
    // within its own row (the midpoint to its row-neighbors on either
    // side), so a long category name never runs into the label beside it.
    const wrappedLabels: string[][] = new Array(segCounts.length);
    for (const row of grid.rows) {
      const rowBandWidths = computeLabelBandWidths(
        row.map((g) => grid.x[g]),
        width,
      );
      row.forEach((g, i) => {
        wrappedLabels[g] = wrapLabel(seg.values[g], Math.max(20, rowBandWidths[i] - LABEL_BAND_PADDING), LABEL_CHAR_WIDTH);
      });
    }
    // One band depth for every row, sized to the segment's longest wrapped
    // label — keeps the grid regular instead of each row's label band
    // jumping around with its own local max.
    const maxLabelLines = Math.max(1, ...wrappedLabels.map((lines) => lines.length));
    const labelBandHeight = LABEL_TOP_MARGIN + maxLabelLines * LABEL_LINE_HEIGHT + PLOT_TOP_GAP;

    const rowOf = new Array(segCounts.length).fill(0);
    const nY = new Array(grid.rows.length).fill(0);
    const cells: GroupCell[] = new Array(segCounts.length);
    let cursor = 0;
    grid.rows.forEach((row, ri) => {
      // Every row — including "All respondents"' single row — is sized the
      // same way: its own largest blob's radius plus a fixed pad. Uniform
      // dot spacing (packSwarm) means blob size is purely a function of
      // count, so there's no reason for any row to be sized differently.
      const rowPlotHeight = Math.max(MIN_ROW_PLOT, 2 * (Math.max(...row.map((g) => grid.radius[g])) + ROW_PAD));
      const plotTop = cursor + labelBandHeight;
      nY[ri] = cursor + LABEL_TOP_MARGIN + maxLabelLines * LABEL_LINE_HEIGHT;
      row.forEach((g) => {
        rowOf[g] = ri;
        cells[g] = { x: grid.x[g], y: plotTop + rowPlotHeight / 2 };
      });
      cursor = plotTop + rowPlotHeight;
    });

    return { cells, wrappedLabels, rowOf, nY, svgHeight: cursor + BOTTOM_PAD };
  }

  const geometry = $derived(geometryFor(segmentIndex));

  const question = $derived(data.meta.questions[questionIndex]);

  function layoutKey(segIdx: number): string {
    return `${segIdx}:${width}x${height}`;
  }

  function itemsFor(segIdx: number): SwarmItem[] {
    if (segIdx === -1) return data.respondents.map((r) => ({ id: r.id, group: 0 }));
    return data.respondents.map((r) => ({ id: r.id, group: r.seg[segIdx] }));
  }

  function requestLayout(segIdx: number): Promise<PositionedDot[]> {
    const cells = geometryFor(segIdx).cells;
    // The "All respondents" layout (packSwarm with a single group) is pure,
    // deterministic, and sub-millisecond even at corpus scale — no need for
    // the worker or the cache that the multi-group path below requires.
    if (segIdx === -1) {
      const opts = { groups: 1, width, height, r: R, gap: GAP, cells };
      return Promise.resolve(packSwarm(itemsFor(segIdx), opts));
    }
    return swarmLayoutCache.get(layoutKey(segIdx), () =>
      packSwarmAsync(itemsFor(segIdx), {
        groups: data.meta.segments[segIdx].values.length,
        width,
        height,
        r: R,
        gap: GAP,
        cells,
      }),
    );
  }

  // The packed layout itself — respondents order, same as data.respondents
  // and groupOf. Depends only on the demographic axis (segmentIndex), never
  // on clustering: clustering is a pure permutation applied on top (see
  // `positions` below), not a re-pack, so toggling it never touches this.
  let layout = $state<PositionedDot[] | null>(null);
  // True only while awaiting a breakdown that wasn't already cached — the
  // common case (pre-warmed, or already visited) never sets this. Dims the
  // existing dots rather than clearing them, so a slow first hit never
  // flashes to blank.
  let pendingLayout = $state(false);

  $effect(() => {
    const segIdx = segmentIndex;
    const key = layoutKey(segIdx);
    if (segIdx !== -1 && !swarmLayoutCache.has(key)) pendingLayout = true;
    requestLayout(segIdx).then((dots) => {
      layout = dots;
      pendingLayout = false;
    });
  });

  // The rendered positions: clustering reassigns which respondent sits at
  // which of the layout's existing coordinates (see clusterByRank/rankOf)
  // — it never computes new ones, so this is cheap enough to run on every
  // toggle, unlike requestLayout above.
  const positions = $derived.by(() => {
    if (!layout) return new Map<string, PositionedDot>();
    const dots = rankOf ? clusterByRank(layout, groupOf, rankOf) : layout;
    return new Map(dots.map((d) => [d.id, d]));
  });

  onMount(() => {
    const idle: (fn: () => void) => void =
      "requestIdleCallback" in window
        ? (fn) => window.requestIdleCallback(fn)
        : (fn) => setTimeout(fn, 200);

    idle(() => {
      data.meta.segments.forEach((_, segIdx) => {
        if (segIdx === segmentIndex) return;
        requestLayout(segIdx);
      });
    });
  });

  let selectedId = $state<string | null>(null);
  const selectedRespondent = $derived(data.respondents.find((r) => r.id === selectedId) ?? null);

  function statusLabelFor(resp: (typeof data.respondents)[number]): string {
    return data.meta.statuses[resp.status[questionIndex]];
  }

  // Highlight is a second, independent legend — dimming (opacity) never
  // touches fill, so a picked theme doesn't replace the color key, it joins
  // it (see the two CategoryLegend instances below). Captioned with the
  // theme's own label so it's never mistaken for the color key above it.
  const highlightLegend = $derived.by(() => {
    if (!highlightOf) return null;
    const matched = highlightOf.filter(Boolean).length;
    return {
      values: ["Raised this theme", "Did not"],
      colors: ["var(--dot)", "color-mix(in oklab, var(--dot) 15%, transparent)"],
      counts: [matched, highlightOf.length - matched],
    };
  });
</script>

<section class="beeswarm">
  <header>
    <p class="eyebrow">EngagedCA AI consultation · sample composition</p>
    <h2>{segment.label}</h2>
    <p class="question">{question.prompt}</p>
    <p class="caveat">{data.meta.sampleCaveat}</p>
  </header>

  <div class="plot-row">
    <svg
      {width}
      height={geometry.svgHeight}
      viewBox="0 0 {width} {geometry.svgHeight}"
      role="img"
      aria-label="{segment.label} breakdown of {data.respondents.length} respondents"
    >
      {#if pendingLayout && positions.size === 0}
        <text x={width / 2} y={geometry.svgHeight / 2} text-anchor="middle" class="packing-status">
          Arranging {data.respondents.length} respondents…
        </text>
      {/if}
      <g class:pending={pendingLayout}>
        {#each data.respondents as resp, i (resp.id)}
          {@const dot = positions.get(resp.id)}
          {#if dot}
            <g
              class="dot-wrap"
              style="transform: translate({dot.x}px, {dot.y}px); transition-delay: {groupOf[i] * STAGGER_MS +
                (clusterOn && highlightOf && !highlightOf[i] ? CLUSTER_UNMATCHED_DELAY_MS : 0)}ms"
              tabindex="0"
              role="button"
              aria-label="Respondent {i + 1} of {data.respondents.length} — {statusLabelFor(resp)}"
              onclick={() => (selectedId = resp.id)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectedId = resp.id;
                }
              }}
            >
              <title
                >{segment.label}: {segment.values[groupOf[i]]}{colorSegment && colorGroupOf && colorSegment.key !== segment.key
                  ? ` · ${colorSegment.label}: ${colorSegment.values[colorGroupOf[i]]}`
                  : ""} · {statusLabelFor(resp)} · {resp.len[questionIndex]} chars written</title
              >
              <circle r={HIT_R} class="hit" />
              <circle
                r={R}
                class="dot"
                class:dimmed={highlightOf ? !highlightOf[i] : false}
                style={colors && colorGroupOf ? `fill: ${colors[colorGroupOf[i]]}` : undefined}
              />
            </g>
          {/if}
        {/each}
      </g>
      <g class="labels">
        {#each segment.values as _, g}
          {@const lines = geometry.wrappedLabels[g]}
          {@const rowNY = geometry.nY[geometry.rowOf[g]]}
          {#each lines as line, li}
            <text
              x={geometry.cells[g].x}
              y={rowNY - (lines.length - li) * LABEL_LINE_HEIGHT}
              text-anchor="middle"
              class="group-label"
            >
              {line}
            </text>
          {/each}
          <text x={geometry.cells[g].x} y={rowNY} text-anchor="middle" class="group-n">
            n={counts[g]}
          </text>
        {/each}
      </g>
    </svg>
  </div>

  {#if colors && colorSegment && colorCounts}
    <CategoryLegend
      values={colorSegment.values}
      {colors}
      counts={colorCounts}
      total={data.respondents.length}
      caption={colorSegment.label}
    />
  {/if}
  {#if highlightLegend}
    <CategoryLegend
      values={highlightLegend.values}
      colors={highlightLegend.colors}
      counts={highlightLegend.counts}
      total={data.respondents.length}
      caption={highlightLabel ?? undefined}
    />
  {/if}
</section>

{#if selectedRespondent}
  <DetailPanel {data} respondent={selectedRespondent} {questionIndex} onClose={() => (selectedId = null)} />
{/if}

<style>
  .beeswarm {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --dot: color-mix(in oklab, var(--muted) 55%, transparent);
    --accent: #2a78d6;

    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .beeswarm {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .beeswarm {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --accent: #3987e5;
  }

  .eyebrow {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h2 {
    margin: 0.4rem 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .question {
    margin: 0 0 0.5rem;
    max-width: 46rem;
    font-size: 1.05rem;
    font-weight: 500;
    line-height: 1.4;
    color: var(--ink);
  }

  .caveat {
    margin: 0 0 1rem;
    max-width: 46rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--muted);
  }

  .plot-row {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
  }

  svg {
    display: block;
    max-width: 100%;
    flex: 1 1 auto;
    min-width: 0;
  }

  g.pending {
    opacity: 0.55;
    transition: opacity 150ms ease;
  }

  .dot-wrap {
    transition: transform 900ms cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
  }

  .hit {
    fill: transparent;
  }

  .dot-wrap:focus-visible .hit {
    fill: transparent;
    stroke: var(--accent);
    stroke-width: 1.5px;
  }

  .dot {
    fill: var(--dot);
    transition: opacity 200ms ease;
  }

  .dot.dimmed {
    opacity: 0.15;
  }

  @media (prefers-reduced-motion: reduce) {
    .dot-wrap {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }

    .dot {
      transition-duration: 0s !important;
    }
  }

  .group-label {
    font-size: 11px;
    fill: var(--ink);
  }

  .group-n {
    font-size: 10px;
    fill: var(--muted);
  }

  .packing-status {
    font-size: 13px;
    fill: var(--muted);
  }
</style>
