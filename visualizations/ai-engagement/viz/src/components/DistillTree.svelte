<script lang="ts">
  /**
   * View B (static) and View C (draw-in animation) — one component, one
   * geometry, a mode switch. The Phase 2 hierarchy (theme -> subtheme ->
   * concept) is a strict tree, drawn with taperedRadialBranch's filled,
   * tapering limbs; the many-to-many Phase 1 fringe uses bundlePath's
   * bundled strands so shared parentage visibly braids together. Step index
   * controls how much of the tree is "grown" — 0 is fully bloomed (all four
   * rings visible), STEP_COUNT-1 is fully drawn-in (only the 3-theme core).
   */
  import { buildLayers, type DistillGraph, type Scope } from "../lib/distill.ts";
  import { taperedRadialBranch, bundlePath } from "../lib/branch.ts";
  import { ringPositions, TOP_ANGLE, type Point } from "../lib/rooms.ts";
  import type { CrosswalkData } from "../lib/crosswalkData.ts";
  import type { RoomsData } from "../lib/roomsData.ts";
  import { assignCategoryColors } from "../lib/palette.ts";
  import Controls from "./Controls.svelte";

  let { crosswalk, rooms }: { crosswalk: CrosswalkData; rooms: RoomsData } = $props();

  const SCOPE_OPTIONS: { key: Scope; label: string }[] = [
    { key: "all", label: "All 112 themes" },
    { key: "policy", label: "Government + economy (72)" },
  ];
  let scope = $state<Scope>("policy");
  const scopeIndex = $derived(SCOPE_OPTIONS.findIndex((o) => o.key === scope));

  const graph = $derived<DistillGraph>(buildLayers(crosswalk, rooms, { scope, minStrength: "primary" }));

  // Radial radii, outer to inner: fringe buds, blossoms (concepts), limb
  // joints (subthemes), core (themes). Chosen so labels at each ring have
  // breathing room without the fringe ring's label text overlapping the
  // next ring in — same "generous minimum, verify visually" approach
  // rooms.ts's own worked example takes.
  const R_CORE = 40;
  const R_LIMB = 160;
  const R_BLOSSOM = 280;
  const R_FRINGE = 420;

  const CENTER: Point = { x: 0, y: 0 };

  function radialPoint(radius: number, index: number, count: number): Point {
    return ringPositions(CENTER, radius, count, TOP_ANGLE)[index] ?? CENTER;
  }

  const coreThemes = $derived(rooms.themes);
  const corePositions = $derived(new Map(coreThemes.map((t, i) => [t.id, radialPoint(R_CORE, i, coreThemes.length)])));

  const limbSubthemes = $derived(rooms.subthemes);
  const limbPositions = $derived(new Map(limbSubthemes.map((s, i) => [s.id, radialPoint(R_LIMB, i, limbSubthemes.length)])));

  const blossomConcepts = $derived(rooms.concepts);
  const blossomPositions = $derived(new Map(blossomConcepts.map((c, i) => [c.id, radialPoint(R_BLOSSOM, i, blossomConcepts.length)])));

  const fringeThemes = $derived(graph.themeNodes);
  const fringePositions = $derived(new Map(fringeThemes.map((t, i) => [t.id, radialPoint(R_FRINGE, i, fringeThemes.length)])));

  const themeColors = $derived(assignCategoryColors(coreThemes.map((t) => t.id)));
  const themeColorOf = $derived(new Map(coreThemes.map((t, i) => [t.id, themeColors[i]])));

  // --- Step-through animation state ---
  // Step 0: fully bloomed (all four rings + all strands visible).
  // Step 1: fringe retracts — bud strands hidden, only blossoms->limbs->core.
  // Step 2: blossoms retract — only limbs->core.
  // Step 3: fully drawn-in — only the 3-theme core.
  const STEP_LABELS = $derived([
    "Bloomed: everything the public raised",
    `Distilled to ${blossomConcepts.length} concepts`,
    `Distilled to ${limbSubthemes.length} subthemes`,
    `Distilled to ${coreThemes.length} themes`,
  ]);
  let step = $state(0);
  let direction = $state<"draw-in" | "bloom">("draw-in");

  function next() {
    if (direction === "draw-in") step = Math.min(step + 1, STEP_LABELS.length - 1);
    else step = Math.max(step - 1, 0);
  }
  function reset() {
    step = direction === "draw-in" ? 0 : STEP_LABELS.length - 1;
  }
  function setDirection(d: "draw-in" | "bloom") {
    direction = d;
    reset();
  }

  const showFringe = $derived(step === 0);
  const showBlossoms = $derived(step <= 1);
  const showLimbs = $derived(step <= 2);
</script>

<div class="controls-row">
  <Controls options={SCOPE_OPTIONS} activeIndex={scopeIndex} onSelect={(i) => (scope = SCOPE_OPTIONS[i].key)} ariaLabel="Phase 1 scope" />
  <Controls
    options={[{ key: "draw-in", label: "Draw-in" }, { key: "bloom", label: "Bloom (replay)" }]}
    activeIndex={direction === "draw-in" ? 0 : 1}
    onSelect={(i) => setDirection(i === 0 ? "draw-in" : "bloom")}
    ariaLabel="Animation direction"
  />
  <button type="button" class="step-btn" onclick={next}>Step: {STEP_LABELS[step]}</button>
</div>

{#if crosswalk.meta.status === "proposed"}
  <div class="proposed-banner" role="status">
    Interpretive crosswalk — <strong>proposed, not yet reviewed</strong>.
  </div>
{/if}

<svg viewBox="{-R_FRINGE - 80} {-R_FRINGE - 80} {2 * (R_FRINGE + 80)} {2 * (R_FRINGE + 80)}" width="900" height="900" role="img" aria-label="Radial distillation tree">
  {#each graph.edges as edge}
    {@const leaf = fringePositions.get(edge.code)}
    {@const blossom = blossomPositions.get(edge.conceptId)}
    {@const concept = rooms.concepts.find((c) => c.id === edge.conceptId)}
    {@const via = concept ? limbPositions.get(concept.subthemeId) : undefined}
    {#if leaf && blossom && via}
      <path
        class="strand"
        d={bundlePath(leaf, via, blossom, 0.6)}
        fill="none"
        stroke={themeColorOf.get(concept?.themeId ?? "") ?? "#bcbbc1"}
        stroke-width={Math.max(edge.wTarget * 6, 0.4)}
        opacity={showFringe ? 0.5 : 0}
      />
    {/if}
  {/each}

  {#each blossomConcepts as concept}
    {@const from = limbPositions.get(concept.subthemeId)}
    {@const to = blossomPositions.get(concept.id)}
    {#if from && to}
      <path class="limb" d={taperedRadialBranch(from, to, 6, 2)} fill={themeColorOf.get(concept.themeId) ?? "#0d4f8c"} opacity={showBlossoms ? 0.85 : 0} />
    {/if}
  {/each}

  {#each limbSubthemes as subtheme}
    {@const from = corePositions.get(subtheme.themeId)}
    {@const to = limbPositions.get(subtheme.id)}
    {#if from && to}
      <path class="limb" d={taperedRadialBranch(from, to, 16, 6)} fill={themeColorOf.get(subtheme.themeId) ?? "#0d4f8c"} opacity={showLimbs ? 1 : 0} />
    {/if}
  {/each}

  {#each coreThemes as theme}
    {@const pos = corePositions.get(theme.id)}
    {#if pos}
      <circle cx={pos.x} cy={pos.y} r="14" fill={themeColorOf.get(theme.id) ?? "#0d4f8c"} />
      <text x={pos.x} y={pos.y + 26} font-size="10" text-anchor="middle">{theme.name}</text>
    {/if}
  {/each}

  {#each fringeThemes as t}
    {@const pos = fringePositions.get(t.id)}
    {#if pos}
      <circle class="fringe-dot" cx={pos.x} cy={pos.y} r={Math.max(t.weight * 40, 1.5)} fill="#bcbbc1" opacity={showFringe ? 1 : 0} />
    {/if}
  {/each}
</svg>

<style>
  .controls-row {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1rem;
    align-items: center;
  }
  .step-btn {
    font: inherit;
    font-size: 0.82rem;
    border: 1px solid var(--rule, #ccd5dd);
    background: transparent;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }
  .proposed-banner {
    background: #fff3cd;
    color: #6b5300;
    border: 1px solid #e0c56a;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .limb,
  .strand {
    transition: opacity 600ms ease;
  }
  .fringe-dot {
    transition: opacity 600ms ease;
  }
  svg text {
    fill: var(--text-primary, #0b0b0b);
  }
  @media (prefers-reduced-motion: reduce) {
    .limb,
    .strand,
    .fringe-dot {
      transition: none;
    }
  }
</style>
