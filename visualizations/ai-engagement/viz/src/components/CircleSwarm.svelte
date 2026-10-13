<script lang="ts">
  /**
   * The three color-by-demographic prototypes (interleaved / banded /
   * wedges) — one component, differing only in `order`, which is forwarded
   * straight to packCircle. Positions are pure and sub-millisecond even at
   * corpus scale, so — like Beeswarm's "All respondents" packOval path —
   * this never touches the worker or swarmLayoutCache.
   */
  import { packCircle, clusterByRank, type CircleOrder, type PositionedDot, type SwarmItem } from "../lib/swarm.ts";
  import { colorsForSegment } from "../lib/palette.ts";
  import type { RespondentsData } from "../lib/data.ts";
  import DetailPanel from "./DetailPanel.svelte";
  import CategoryLegend from "./CategoryLegend.svelte";

  const R = 2.5;
  const GAP = 1;
  const HIT_R = 5;
  const STAGGER_MS = 18;
  // When clustering, unmatched dots wait a beat behind matched ones so the
  // core reads as forming first — same rule as Beeswarm.svelte.
  const CLUSTER_UNMATCHED_DELAY_MS = 120;

  let {
    data,
    segmentIndex,
    questionIndex,
    order,
    highlightOf = null,
    highlightLabel = null,
    clusterOn = false,
    stanceIndexOf = null,
    stanceCategoryCount = 0,
    stanceGroupOn = false,
    size = 620,
  }: {
    data: RespondentsData;
    segmentIndex: number;
    questionIndex: number;
    order: CircleOrder;
    /** One boolean per respondent (data.respondents order) — true if they
     * raised the picked theme on the current question. null means no
     * theme is picked. Dims via opacity, independent of the breakdown
     * color. */
    highlightOf?: boolean[] | null;
    /** The picked theme's own label — just for captioning highlightLegend
     * below, so it reads unambiguously next to the color key. */
    highlightLabel?: string | null;
    /** "Cluster matches" toggle — see Beeswarm.svelte for the shared
     * contract. Moves matched dots to the inner ring of packCircle's
     * annulus (or the core of a wedge), via a pure permutation of the
     * existing golden-angle positions. */
    clusterOn?: boolean;
    /** See Beeswarm.svelte for the shared "Group by stance" contract. */
    stanceIndexOf?: number[] | null;
    stanceCategoryCount?: number;
    stanceGroupOn?: boolean;
    size?: number;
  } = $props();

  // Same rank composition rule as Beeswarm.svelte — see there for why
  // theme-match is always the primary key when both toggles are active.
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

  // Same synthetic "All respondents" sentinel as Beeswarm.svelte — one
  // group holding everyone, with nothing to color by.
  const ALL_SEGMENT = { key: "ALL", label: "All respondents", values: ["All respondents"], rawValues: ["All respondents"] };
  const segment = $derived(segmentIndex === -1 ? ALL_SEGMENT : data.meta.segments[segmentIndex]);
  const groupOf = $derived(
    segmentIndex === -1 ? data.respondents.map(() => 0) : data.respondents.map((r) => r.seg[segmentIndex]),
  );

  const counts = $derived.by(() => {
    const c = new Array(segment.values.length).fill(0);
    for (const g of groupOf) c[g]++;
    return c;
  });

  // Colors always match the breakdown here — no independent color axis in
  // the circle prototypes (Beeswarm has one instead). colorsForSegment
  // still dispatches to the stance-specific palette when the breakdown
  // itself is Stance, rather than the generic categorical ramp.
  const colors = $derived(segmentIndex === -1 ? null : colorsForSegment(segment.key, segment.values));

  const items: SwarmItem[] = $derived(data.respondents.map((r, i) => ({ id: r.id, group: groupOf[i] })));
  const opts = $derived({ groups: segment.values.length, width: size, height: size, r: R, gap: GAP });
  const positions: Map<string, PositionedDot> = $derived.by(() => {
    const layout = packCircle(items, opts, order);
    const dots = rankOf ? clusterByRank(layout, groupOf, rankOf) : layout;
    return new Map(dots.map((d) => [d.id, d]));
  });

  const question = $derived(data.meta.questions[questionIndex]);

  function statusLabelFor(resp: (typeof data.respondents)[number]): string {
    return data.meta.statuses[resp.status[questionIndex]];
  }

  const headlineLines = $derived(
    segmentIndex === -1
      ? [data.respondents.length.toLocaleString(), "Californians"]
      : [data.respondents.length.toLocaleString(), "Californians", `by ${segment.label}`],
  );
  const cx = $derived(size / 2);
  const cy = $derived(size / 2);

  let selectedId = $state<string | null>(null);
  const selectedRespondent = $derived(data.respondents.find((r) => r.id === selectedId) ?? null);

  // Same second-independent-legend rule as Beeswarm — see there for why.
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

<section class="circle-swarm">
  <header>
    <p class="eyebrow">EngagedCA AI consultation · sample composition</p>
    <h2>{segment.label}</h2>
    <p class="question">{question.prompt}</p>
    <p class="caveat">{data.meta.sampleCaveat}</p>
  </header>

  <svg
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    role="img"
    aria-label="{segment.label} breakdown of {data.respondents.length} respondents"
  >
    <g>
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
              >{segment.label}: {segment.values[groupOf[i]]} · {statusLabelFor(resp)} · {resp
                .len[questionIndex]} chars written</title
            >
            <circle r={HIT_R} class="hit" />
            <circle
              r={R}
              class="dot"
              class:dimmed={highlightOf ? !highlightOf[i] : false}
              style={colors ? `fill: ${colors[groupOf[i]]}` : undefined}
            />
          </g>
        {/if}
      {/each}
    </g>
    <g class="headline" transform="translate({cx}, {cy})">
      {#each headlineLines as line, li}
        <text
          x="0"
          y={(li - (headlineLines.length - 1) / 2) * 20}
          text-anchor="middle"
          class={li === 0 ? "headline-count" : "headline-line"}
        >
          {line}
        </text>
      {/each}
    </g>
  </svg>

  {#if colors}
    <CategoryLegend values={segment.values} {colors} {counts} total={data.respondents.length} caption={segment.label} />
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
  .circle-swarm {
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
    :root:where(:not([data-theme="light"])) .circle-swarm {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .circle-swarm {
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

  svg {
    display: block;
    max-width: 100%;
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
    transition: fill 300ms ease, opacity 200ms ease;
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

  .headline {
    pointer-events: none;
  }

  .headline-count {
    font-size: 28px;
    font-weight: 700;
    fill: var(--ink);
  }

  .headline-line {
    font-size: 13px;
    fill: var(--muted);
  }
</style>
