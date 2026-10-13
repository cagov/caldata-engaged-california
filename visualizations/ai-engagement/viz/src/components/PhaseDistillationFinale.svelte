<script lang="ts">
  /**
   * Stage 7's finale — the full Phase 1 -> Phase 2 distillation animation
   * from sketches/concept-distillation-real-phase2-themes.html, ported onto
   * this app's shared canvas coordinate space and Engaged California tokens.
   * Reuses phase1CloudDraw.ts's drawPhase1Cloud() unchanged from
   * PhaseOneConceptCloud.svelte — the only new code here is the
   * hold0/distill/hold1 timeline clock, since the static component only
   * ever needed p=0.
   *
   * Runs its own internal requestAnimationFrame loop, entirely decoupled
   * from ParticipantFunnelCloud.svelte's own dot-canvas clock — the two
   * animations never need to interact. `playing`/`looping`/`paletteVersion`
   * are read from the parent's own state (no separate transport or palette
   * control for this stage); `active` resets the internal clock to p=0
   * whenever this stage is freshly entered.
   *
   * `topTrim` defaults to 0 (this file's original behavior, still true for
   * ParticipantFunnelCloudConcepts.svelte, the only caller before
   * DiscussionSection.svelte) — set it to a nonzero canvas-space px count
   * when the caller's own canvas is shorter than CANVAS.H because a DOM
   * header replaced its top band, same TOP_TRIM trick
   * ParticipantFunnelSelection.svelte's resize() introduced: the *window*
   * onto this component's own unchanged CANVAS.W x CANVAS.H drawing (and
   * phase1CloudDraw.ts's LAYOUT space nested inside it) shifts, not the
   * coordinates drawPhase1Cloud() computes.
   *
   * `progress` is bindable and optional — DiscussionSection.svelte reads it
   * to count its own header stat down from the Phase 1 concept count to 27
   * in step with this file's own hold0/distill/hold1 clock, rather than
   * that number snapping the moment the view is switched to (the header's
   * stage-crossfade, a much shorter ~1.4s tween, would otherwise reach 27
   * long before this multi-second animation visually finishes merging
   * anything). ParticipantFunnelCloudConcepts.svelte doesn't bind it —
   * its own header count already snaps on that file's own stage-transition,
   * unchanged by this addition.
   */
  import { onMount, onDestroy } from "svelte";
  import { PHASE1_CLOUD_LAYOUT } from "../lib/phase1Cloud.ts";
  import { drawPhase1Cloud } from "../lib/phase1CloudDraw.ts";
  import { CANVAS } from "../lib/funnelCloud.ts";
  import { watchEcTokens, type EcCanvasTokens } from "../lib/ecCanvasTokens.ts";

  let {
    active,
    playing,
    looping,
    paletteVersion,
    topTrim = 0,
    progress = $bindable(0),
  }: {
    active: boolean;
    playing: boolean;
    looping: boolean;
    paletteVersion: "engaged" | "odi";
    topTrim?: number;
    progress?: number;
  } = $props();

  const layout = PHASE1_CLOUD_LAYOUT;

  const HOLD0_MS = 2200;
  const DISTILL_MS = 9200;
  const HOLD1_MS = 4600;

  let p = 0;
  let phase: "hold0" | "distill" | "hold1" = "hold0";
  let dwellLeft = HOLD0_MS;
  let lastTime = 0;
  let rafId = 0;

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

  function resetClock() {
    p = 0;
    progress = 0;
    phase = "hold0";
    dwellLeft = HOLD0_MS;
  }

  // Fresh arrival at stage 7 always restarts the story from Phase 1, same
  // as jumping to any other stage never resumes mid-transition.
  $effect(() => {
    if (active) resetClock();
  });

  function render() {
    if (!ctx) return;
    drawPhase1Cloud(ctx, layout, p, ecTokens.surface, ecTokens.onSurfaceMuted, paletteVersion);
  }

  function resize() {
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || CANVAS.W;
    const scale = cssWidth / CANVAS.W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvasH = CANVAS.H - topTrim;
    canvas.width = CANVAS.W * scale * dpr;
    canvas.height = canvasH * scale * dpr;
    canvas.style.height = `${canvasH * scale}px`;
    ctx = canvas.getContext("2d");
    // Shifts the visible window up by topTrim canvas-space px (in device
    // pixels: topTrim * scale * dpr) rather than translating drawPhase1Cloud's
    // own draw calls — see topTrim's doc comment above.
    ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, -topTrim * scale * dpr);
    render();
  }

  function frame(now: number) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    if (active && playing) {
      if (phase === "hold0") {
        dwellLeft -= dt;
        if (dwellLeft <= 0) phase = "distill";
      } else if (phase === "distill") {
        p = Math.min(1, p + dt / DISTILL_MS);
        progress = p;
        if (p >= 1) {
          phase = "hold1";
          dwellLeft = HOLD1_MS;
        }
      } else {
        dwellLeft -= dt;
        if (dwellLeft <= 0) {
          if (looping) resetClock();
          // Not looping: hold on the fully-distilled Phase 2 picture rather
          // than freezing dwellLeft at a negative number, which would just
          // re-enter this branch every frame for no visible effect.
          else dwellLeft = 0;
        }
      }
    }

    render();
    rafId = requestAnimationFrame(frame);
  }

  onMount(() => {
    resize();
    window.addEventListener("resize", resize);
    stopWatchingEcTokens = watchEcTokens(canvas, (tokens) => {
      ecTokens = tokens;
      render();
    });
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    stopWatchingEcTokens?.();
  });
</script>

<canvas
  bind:this={canvas}
  width={CANVAS.W}
  height={CANVAS.H - topTrim}
  class="phase-distillation-finale"
  class:visible={active}
  inert={!active}
  aria-hidden={!active}
  aria-label="Animation in which 126 placeholder Phase 1 concepts travel into and merge with the 27 real Phase 2 policy concepts, which grow to their true size as they absorb them."
></canvas>

<style>
  .phase-distillation-finale {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
    transition: opacity 400ms ease;
  }
  .phase-distillation-finale.visible {
    opacity: 1;
  }
</style>
