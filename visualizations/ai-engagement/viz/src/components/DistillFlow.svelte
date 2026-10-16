<script lang="ts">
  /**
   * View A: the vertical alluvial. Two columns only — Phase 1 themes on the
   * left, the 29 Phase 2 policy concepts on the right — plus a dedicated
   * "did not carry forward" channel fed by buildLayers' own `unclaimed`
   * list. This deliberately does NOT draw the concept->subtheme->theme
   * rollup (distill.ts still computes conceptEdges/subthemeEdges for the
   * hidden radial-tree view; this component just doesn't render them) —
   * the story here is "many diffuse ideas distilled into 29 concepts," and
   * the rollup columns diluted that story and made hover ambiguous about
   * which stage it was isolating. Ribbon geometry only — buildLayers
   * (distill.ts) does every weight/normalization/ordering decision; this
   * component never recomputes a number distill.ts already produced.
   */
  import { buildLayers, type DistillGraph, type Scope } from "../lib/distill.ts";
  import type { CrosswalkData } from "../lib/crosswalkData.ts";
  import type { RoomsData } from "../lib/roomsData.ts";
  import { assignCategoryColors } from "../lib/palette.ts";
  import { wrapLabel } from "../lib/labels.ts";
  import Controls from "./Controls.svelte";

  let { crosswalk, rooms }: { crosswalk: CrosswalkData; rooms: RoomsData } = $props();

  const SCOPE_OPTIONS: { key: Scope; label: string }[] = [
    { key: "all", label: "All 112 themes" },
    { key: "policy", label: "Government + economy (72)" },
  ];
  let scope = $state<Scope>("policy");
  const scopeIndex = $derived(SCOPE_OPTIONS.findIndex((o) => o.key === scope));

  type StrengthFilter = "primary" | "secondary" | "tangential";
  const STRENGTH_OPTIONS: { key: StrengthFilter; label: string }[] = [
    { key: "primary", label: "Primary only" },
    { key: "secondary", label: "+ Secondary" },
    { key: "tangential", label: "Everything" },
  ];
  let minStrength = $state<StrengthFilter>("primary");
  const strengthIndex = $derived(STRENGTH_OPTIONS.findIndex((o) => o.key === minStrength));

  const graph = $derived<DistillGraph>(buildLayers(crosswalk, rooms, { scope, minStrength }));

  // Layout constants — two columns (theme, concept) with labels living in
  // the margins OUTSIDE the ribbon area (theme labels to the left of the
  // theme column, concept labels to the right of the concept column),
  // standard Sankey convention, so labels never compete with ribbons or
  // with each other's column for space.
  const NODE_HEIGHT_MIN = 960;
  const NODE_THICKNESS = 20;
  const THEME_LABEL_WIDTH = 240;
  const RIBBON_WIDTH = 480;
  const CONCEPT_LABEL_WIDTH = 260;
  const GAP_TO_UNCLAIMED = 50;
  const UNCLAIMED_LABEL_WIDTH = 150;

  const THEME_X = THEME_LABEL_WIDTH;
  const CONCEPT_X = THEME_X + NODE_THICKNESS + RIBBON_WIDTH;
  const UNCLAIMED_X = CONCEPT_X + NODE_THICKNESS + CONCEPT_LABEL_WIDTH + GAP_TO_UNCLAIMED;
  const CHART_WIDTH = UNCLAIMED_X + NODE_THICKNESS + UNCLAIMED_LABEL_WIDTH;

  // Below this rendered height, a persistent label would collide with its
  // neighbors' — hide it and reveal it only on hover/focus instead. This is
  // also what gives hovering a single, explainable job: "read a name that
  // doesn't fit, and see what it connects to."
  const MIN_LABEL_HEIGHT = 13;

  interface LaidOutNode {
    id: string;
    label: string;
    x: number;
    y0: number;
    y1: number;
    color: string;
  }

  function layoutColumn(nodeIds: string[], x: number, colorOf: (id: string) => string): LaidOutNode[] {
    const gap = 1;
    const totalGap = Math.max(nodeIds.length - 1, 0) * gap;
    const height = NODE_HEIGHT_MIN - totalGap;
    let cursor = 0;
    return nodeIds.map((id) => {
      const node = graph.nodesById.get(id);
      const span = (node?.weight ?? 0) * height;
      const laid = { id, label: node?.label ?? id, x, y0: cursor, y1: cursor + span, color: colorOf(id) };
      cursor += span + gap;
      return laid;
    });
  }

  const themeColors = $derived.by(() => {
    const ids = graph.themeNodes.map((t) => t.id);
    const palette = assignCategoryColors(ids);
    return new Map(ids.map((id, i) => [id, palette[i]]));
  });
  const unclaimedColor = "#bcbbc1"; // DATA_VIZ_NEUTRAL_LIGHT — matches palette.ts's own non-substantive gray

  // Concepts are still tinted by their ultimate Phase 2 theme (T1/T2/T3) —
  // useful context retained from the rollup without drawing the rollup
  // columns themselves.
  const theme2Colors = $derived(assignCategoryColors(rooms.themes.map((t) => t.id)));
  const theme2ColorOf = $derived(new Map(rooms.themes.map((t, i) => [t.id, theme2Colors[i]])));
  const conceptThemeIdOf = $derived(new Map(rooms.concepts.map((c) => [c.id, c.themeId])));

  const themeLevel = $derived(layoutColumn(graph.levels[0].nodeIds, THEME_X, (id) => themeColors.get(id) ?? unclaimedColor));
  const conceptLevel = $derived(
    layoutColumn(graph.levels[1].nodeIds, CONCEPT_X, (id) => theme2ColorOf.get(conceptThemeIdOf.get(id) ?? "") ?? "#0d4f8c"),
  );

  // The unclaimed channel sits further right still, sized by its own
  // (smaller) height budget and drawn detached (a gap, not a ribbon) — see
  // the spec: "first-class, labelled, and clickable".
  const unclaimedNodes = $derived.by(() => {
    let cursor = 0;
    const total = graph.unclaimed.reduce((a, t) => a + t.raw, 0) || 1;
    return graph.unclaimed.map((t) => {
      const span = (t.raw / total) * (NODE_HEIGHT_MIN * 0.6); // a smaller lane than the main channel — it's a reference list, not competing for primary attention
      const laid = { id: t.id, label: t.label, x: UNCLAIMED_X, y0: cursor, y1: cursor + span, color: unclaimedColor };
      cursor += span;
      return laid;
    });
  });

  function nodeMidY(node: LaidOutNode): number {
    return (node.y0 + node.y1) / 2;
  }

  function ribbonPath(source: LaidOutNode, sw: number, target: LaidOutNode, tw: number): string {
    const x0 = source.x + NODE_THICKNESS;
    const x1 = target.x;
    const xm = (x0 + x1) / 2;
    const sy0 = nodeMidY(source) - sw / 2;
    const sy1 = nodeMidY(source) + sw / 2;
    const ty0 = nodeMidY(target) - tw / 2;
    const ty1 = nodeMidY(target) + tw / 2;
    return [
      `M ${x0} ${sy0}`,
      `C ${xm} ${sy0} ${xm} ${ty0} ${x1} ${ty0}`,
      `L ${x1} ${ty1}`,
      `C ${xm} ${ty1} ${xm} ${sy1} ${x0} ${sy1}`,
      "Z",
    ].join(" ");
  }

  let hoveredId = $state<string | null>(null);

  function edgeTouchesHover(edge: { code: string; conceptId: string }): boolean {
    if (hoveredId === null) return true;
    return edge.code === hoveredId || edge.conceptId === hoveredId;
  }

  function showLabel(node: LaidOutNode): boolean {
    return node.y1 - node.y0 >= MIN_LABEL_HEIGHT || hoveredId === node.id;
  }

  const CHAR_WIDTH_PX = 6.2;
</script>

<div class="controls-row">
  <Controls options={SCOPE_OPTIONS} activeIndex={scopeIndex} onSelect={(i) => (scope = SCOPE_OPTIONS[i].key)} ariaLabel="Phase 1 scope" />
  <Controls options={STRENGTH_OPTIONS} activeIndex={strengthIndex} onSelect={(i) => (minStrength = STRENGTH_OPTIONS[i].key)} ariaLabel="Edge filter" />
</div>

<p class="legend-note">
  Ribbon width is a <em>proportion at both ends</em>, not an absolute count:
  at the Phase 1 end it's a share of that theme's attention; at the Phase 2
  end, a share of that concept's parentage. Phase 1 is measured in people,
  Phase 2 in votes and sessions — the two are never on one shared scale.
  Hover a theme or concept to see exactly what it connects to and read its
  name — short bars hide their label until hovered so nothing overlaps.
</p>

<svg viewBox="0 -24 {CHART_WIDTH + 20} {NODE_HEIGHT_MIN + 24}" width={CHART_WIDTH + 20} height={NODE_HEIGHT_MIN + 24} role="img" aria-label="Distillation flow from Phase 1 themes to Phase 2 policy concepts">
  {#each graph.edges as edge}
    {@const source = themeLevel.find((n) => n.id === edge.code)}
    {@const target = conceptLevel.find((n) => n.id === edge.conceptId)}
    {#if source && target}
      <path
        d={ribbonPath(source, edge.wSource * (source.y1 - source.y0), target, edge.wTarget * (target.y1 - target.y0))}
        fill={themeColors.get(edge.code) ?? unclaimedColor}
        opacity={edgeTouchesHover(edge) ? 0.55 : 0.08}
      />
    {/if}
  {/each}

  {#each themeLevel as node}
    <rect
      x={node.x}
      y={node.y0}
      width={NODE_THICKNESS}
      height={Math.max(node.y1 - node.y0, 2)}
      fill={node.color}
      role="button"
      tabindex="0"
      aria-label={node.label}
      onmouseenter={() => (hoveredId = node.id)}
      onmouseleave={() => (hoveredId = null)}
      onfocus={() => (hoveredId = node.id)}
      onblur={() => (hoveredId = null)}
    />
    {#if showLabel(node)}
      {#each wrapLabel(node.label, THEME_LABEL_WIDTH - 8, CHAR_WIDTH_PX) as line, li}
        <text x={node.x - 8} y={nodeMidY(node) + li * 11} font-size="10" text-anchor="end">{line}</text>
      {/each}
    {/if}
  {/each}

  {#each conceptLevel as node}
    <rect
      x={node.x}
      y={node.y0}
      width={NODE_THICKNESS}
      height={Math.max(node.y1 - node.y0, 2)}
      fill={node.color}
      role="button"
      tabindex="0"
      aria-label={node.label}
      onmouseenter={() => (hoveredId = node.id)}
      onmouseleave={() => (hoveredId = null)}
      onfocus={() => (hoveredId = node.id)}
      onblur={() => (hoveredId = null)}
    />
    {#if showLabel(node)}
      {#each wrapLabel(node.label, CONCEPT_LABEL_WIDTH - 8, CHAR_WIDTH_PX) as line, li}
        <text x={node.x + NODE_THICKNESS + 8} y={nodeMidY(node) + li * 11} font-size="10">{line}</text>
      {/each}
    {/if}
  {/each}

  <g class="unclaimed-channel">
    <text x={UNCLAIMED_X} y="-8" font-size="11" font-weight="600">Not carried forward at this filter ({graph.unclaimed.length} of {graph.themeNodes.length + graph.unclaimed.length})</text>
    {#each unclaimedNodes as node}
      <rect
        x={node.x}
        y={node.y0}
        width={NODE_THICKNESS}
        height={Math.max(node.y1 - node.y0, 2)}
        fill={node.color}
        role="button"
        tabindex="0"
        aria-label={`${node.label} — no concept claims this theme at the current strength filter`}
        onmouseenter={() => (hoveredId = node.id)}
        onmouseleave={() => (hoveredId = null)}
        onfocus={() => (hoveredId = node.id)}
        onblur={() => (hoveredId = null)}
      />
      {#if showLabel(node)}
        {#each wrapLabel(node.label, UNCLAIMED_LABEL_WIDTH - 8, CHAR_WIDTH_PX) as line, li}
          <text x={node.x + NODE_THICKNESS + 8} y={nodeMidY(node) + li * 11} font-size="10">{line}</text>
        {/each}
      {/if}
    {/each}
  </g>
</svg>

<style>
  .controls-row {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .legend-note {
    font-size: 0.82rem;
    color: var(--text-secondary, #52514e);
    max-width: 48rem;
    margin: 0 0 1rem;
  }
  svg text {
    fill: var(--text-primary, #0b0b0b);
    pointer-events: none;
  }
  rect[role="button"] {
    cursor: pointer;
  }
  rect[role="button"]:focus-visible {
    outline: 2px solid #2a78d6;
  }
</style>
