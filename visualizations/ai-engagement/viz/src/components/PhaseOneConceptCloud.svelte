<script lang="ts">
  /**
   * Stage 1's "ideas" view — the 126 placeholder Phase 1 concepts drawn at
   * rest (p=0, no animation), crossfaded in over the dot canvas beneath it
   * as `wordsK` ramps from 0 to 1 (an automatic tween driven by the parent
   * component's own stage clock — see ParticipantFunnelCloudConcepts.svelte's
   * `wordsK`/`WORDS_TWEEN_MS`, this component has no transport of its own).
   * All layout/timeline math lives in phase1Cloud.ts; drawPhase1Cloud()
   * (phase1CloudDraw.ts) is the actual canvas draw routine, shared verbatim
   * with PhaseDistillationFinale.svelte so the two views never drift apart
   * visually — this component just calls it once, at a fixed progress.
   */
  import { onMount, onDestroy } from "svelte";
  import { PHASE1_CLOUD_LAYOUT } from "../lib/phase1Cloud.ts";
  import { drawPhase1Cloud } from "../lib/phase1CloudDraw.ts";
  import { CANVAS } from "../lib/funnelCloud.ts";
  import { watchEcTokens, type EcCanvasTokens } from "../lib/ecCanvasTokens.ts";

  let { wordsK, paletteVersion }: { wordsK: number; paletteVersion: "engaged" | "odi" } = $props();

  const layout = PHASE1_CLOUD_LAYOUT;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let ecTokens: EcCanvasTokens = {
    surface: "#ffffff",
    onSurface: "#1c2745",
    onSurfaceMuted: "#444444",
    hairline: "#d4d4d7",
    emphasis: "#1c2745",
    link: "#0d5d90",
    nondata: "#3b3a48",
    dropped: "#d3d3d3",
    graphicHairline: "#8c8c8c",
  };
  let stopWatchingEcTokens: (() => void) | null = null;

  function render() {
    if (!ctx) return;
    drawPhase1Cloud(ctx, layout, 0, ecTokens.surface, ecTokens.onSurfaceMuted, paletteVersion);
  }

  function resize() {
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || CANVAS.W;
    const scale = cssWidth / CANVAS.W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS.W * scale * dpr;
    canvas.height = CANVAS.H * scale * dpr;
    canvas.style.height = `${CANVAS.H * scale}px`;
    ctx = canvas.getContext("2d");
    ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    render();
  }

  onMount(() => {
    resize();
    window.addEventListener("resize", resize);
    stopWatchingEcTokens = watchEcTokens(canvas, (tokens) => {
      ecTokens = tokens;
      render();
    });
  });

  onDestroy(() => {
    window.removeEventListener("resize", resize);
    stopWatchingEcTokens?.();
  });

  // Re-render whenever the palette-review toggle flips, even if this
  // component isn't currently visible (cheap: one static draw, no RAF loop)
  // so it's never showing a stale palette on the next crossfade in.
  $effect(() => {
    void paletteVersion;
    render();
  });
</script>

<canvas
  bind:this={canvas}
  width={CANVAS.W}
  height={CANVAS.H}
  class="phase1-concept-cloud"
  style="opacity: {wordsK}"
  inert={wordsK < 0.01}
  aria-hidden={wordsK < 0.01}
  aria-label="126 placeholder Phase 1 concepts, sized by keyword frequency in the Phase 1 open-text survey, grouped by theme and subtheme."
></canvas>

<style>
  .phase1-concept-cloud {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
