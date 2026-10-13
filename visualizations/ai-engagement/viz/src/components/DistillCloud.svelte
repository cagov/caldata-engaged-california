<script lang="ts">
  /**
   * View D: the animated word cloud. A third rendering of the same graph
   * DistillFlow.svelte (alluvial) and DistillTree.svelte (radial) already
   * draw — buildLayers() (distill.ts) still does every weight/normalization/
   * ordering decision; buildCloud() (cloud.ts) only turns that graph into
   * placed words and flights. This component never recomputes a number
   * either of those modules already produced.
   *
   * Canvas + requestAnimationFrame, not SVG + CSS transitions — a deliberate
   * break from every other prototype in this app. A scrub slider needs
   * random access to an arbitrary point in the animation, and up to 98
   * independently-moving flights is past what CSS transitions on SVG <text>
   * handle smoothly. The break is contained here: all placement and weight
   * math still lives in cloud.ts/distill.ts, this file only draws.
   */
  import { onMount, onDestroy } from "svelte";
  import { buildLayers, type DistillGraph, type Scope } from "../lib/distill.ts";
  import {
    buildCloud,
    restAlpha,
    absorbed,
    wordBox,
    frameCandidates,
    applyOcclusion,
    subthemePalette,
    CLOUD_WIDTH,
    CLOUD_HEIGHT,
    LINE_HEIGHT_EM,
    type CloudLayout,
  } from "../lib/cloud.ts";
  import { DATA_VIZ_NEUTRAL_LIGHT } from "../lib/palette.ts";
  import type { CrosswalkData } from "../lib/crosswalkData.ts";
  import type { RoomsData } from "../lib/roomsData.ts";
  import Controls from "./Controls.svelte";

  let { crosswalk, rooms }: { crosswalk: CrosswalkData; rooms: RoomsData } = $props();

  // Color = which Phase 2 subtheme a word's destination belongs to — calls
  // cloud.ts's own subthemePalette(), the single function buildCloud() uses
  // internally too, so this legend can never independently drift out of
  // sync with what's actually drawn (it briefly could have, back when this
  // called assignCategoryColors directly instead of going through the one
  // shared function that also applies the ST-07 override below). A source
  // word not yet split into flights is tinted by its strongest edge's
  // destination's subtheme (see cloud.ts's dominantColor); gray means no
  // subtheme at all — nothing this filter's crosswalk connects it to.
  const subthemeColors = $derived(subthemePalette(rooms.subthemes.map((s) => s.id)));

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
  const layout = $derived<CloudLayout>(buildCloud(graph, rooms));

  const reachedCount = $derived(layout.targetWords.filter((w) => w.reached).length);

  // --- Animation state machine: hold on Phase 1, distill, hold on Phase 2,
  // loop — same three-phase shape as the reference prototype
  // (sketches/concept-distillation.html), just driven by cloud.ts's own
  // flight math instead of a hand-authored dataset. ---
  const HOLD0_MS = 1800;
  const DISTILL_MS = 7000;
  const HOLD1_MS = 3800;

  let p = $state(0); // 0 = Phase 1, 1 = Phase 2
  let playing = $state(true);
  let looping = $state(true);
  let phase: "hold0" | "distill" | "hold1" = "hold0";
  let dwell = HOLD0_MS;
  let lastTime = 0;
  let rafId = 0;
  let reduced = $state(false);
  let hoveredLabel = $state<string | null>(null);

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  // Every word/flight actually drawn this frame, in canvas coordinates, for
  // hit-testing on pointer move — canvas has no per-shape DOM nodes to hang
  // hover/focus handlers on, so this is the hover mechanism.
  let hitTargets: { label: string; x0: number; y0: number; x1: number; y1: number }[] = [];

  // Chrome palette + type, ported straight from the reference prototype
  // (sketches/concept-distillation.html) — this view is meant to read as that
  // sketch on real data, not as a generic app chart. Word fills still use
  // this app's own subtheme palette (palette.ts); only the header, counters,
  // and controls borrow the reference's ink/gray/blue and Noto type family.
  const INK = "#1E1E1E";
  const GRAY = "#444444";
  const ACCENT = "#0D4F8C";
  const WORD_FONT = "'Noto Sans', Arial, sans-serif";
  const MONO_FONT = "'Noto Sans Mono', ui-monospace, monospace";
  const SERIF_FONT = "'Noto Serif', Georgia, serif";

  function resize() {
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || CLOUD_WIDTH;
    const scale = cssWidth / CLOUD_WIDTH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CLOUD_WIDTH * scale * dpr;
    canvas.height = CLOUD_HEIGHT * scale * dpr;
    canvas.style.height = `${CLOUD_HEIGHT * scale}px`;
    ctx = canvas.getContext("2d");
    ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  function drawWord(word: { x: number; y: number; lines: string[]; fontSize: number; color: string; label: string; alpha: number; weight: 400 | 600; rot?: 0 | 90 }) {
    if (!ctx || word.alpha <= 0.01) return;
    ctx.globalAlpha = word.alpha;
    ctx.fillStyle = word.color;
    ctx.font = `${word.weight} ${word.fontSize}px ${WORD_FONT}`;
    const lineHeight = word.fontSize * LINE_HEIGHT_EM;
    const relStartY = -((word.lines.length - 1) * lineHeight) / 2;
    if (word.rot === 90) {
      // Rotated words are placed by `place()` for the same reason a
      // classic word cloud needs any rotation at all: a short label turned
      // vertical can nest into a gap beside a wide horizontal neighbor near
      // the field's edge that no horizontal-only label could ever reach.
      // Draw in local (rotated) space, not canvas space, so textAlign
      // "center" / textBaseline "middle" still center each line the same
      // way the unrotated branch below does.
      ctx.save();
      ctx.translate(word.x, word.y);
      ctx.rotate(-Math.PI / 2);
      word.lines.forEach((line, i) => ctx!.fillText(line, 0, relStartY + i * lineHeight));
      ctx.restore();
    } else {
      const startY = word.y + relStartY;
      word.lines.forEach((line, i) => ctx!.fillText(line, word.x, startY + i * lineHeight));
    }
    hitTargets.push({ label: word.label, ...wordBox(word) });
  }

  // How many claimed themes are still legible as an origin word (not yet
  // dissolved into its flights) and how many concepts have visibly grown —
  // the same two-counter idea as the reference prototype, just driven by
  // this component's own restAlpha/absorbed instead of a hand-authored
  // recompute(). Reached concepts only: an unreached (ghosted) one is
  // present from frame one, not something that "consolidates" on screen.
  const nRaised = $derived(layout.restWords.filter((w) => restAlpha(w.id, layout, p) > 0.02).length);
  const nConsolidated = $derived(layout.targetWords.filter((w) => w.reached && absorbed(layout, w.id, p) > 0.02).length);

  function drawHeader() {
    if (!ctx) return;
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";

    ctx.textAlign = "left";
    ctx.font = `400 11px ${MONO_FONT}`;
    ctx.fillStyle = GRAY;
    ctx.fillText("P H A S E   1   →   P H A S E   2", 40, 46);

    ctx.font = `700 30px ${SERIF_FONT}`;
    ctx.fillStyle = ACCENT;
    const title = p < 0.04 ? "Phase 1" : p > 0.96 ? "Phase 2" : "Distilling";
    ctx.fillText(title, 40, 82);

    ctx.font = `400 14.5px ${WORD_FONT}`;
    ctx.fillStyle = GRAY;
    const subtitle =
      p < 0.04
        ? "Themes raised across the survey, sized by how many people raised them."
        : p > 0.96
          ? "What they distilled into, sized by sessions + top ideas from deliberation."
          : "Related themes merge into policy concepts; concepts grow as they absorb them.";
    ctx.fillText(subtitle, 40, 106);

    ctx.textAlign = "right";
    ctx.font = `700 40px ${MONO_FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(String(nRaised), CLOUD_WIDTH - 140, 80);
    ctx.font = `400 18px ${MONO_FONT}`;
    ctx.fillStyle = "#B9B9C0";
    ctx.fillText("/", CLOUD_WIDTH - 118, 80);
    ctx.font = `700 40px ${MONO_FONT}`;
    ctx.fillStyle = nConsolidated > 0 ? ACCENT : "#B9B9C0";
    ctx.fillText(String(nConsolidated), CLOUD_WIDTH - 40, 80);
    ctx.font = `400 11.5px ${WORD_FONT}`;
    ctx.fillStyle = GRAY;
    ctx.fillText("raised  /  consolidated", CLOUD_WIDTH - 40, 100);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  function draw() {
    if (!ctx) return;
    hitTargets = [];
    ctx.clearRect(0, 0, CLOUD_WIDTH, CLOUD_HEIGHT);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, CLOUD_WIDTH, CLOUD_HEIGHT);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // applyOcclusion is the legibility fix: with up to ~160 words sharing
    // one continuously-animating field, some transient overlap is
    // unavoidable from position alone (confirmed against the real export —
    // up to 273 simultaneous overlapping pairs otherwise). Rather than a
    // hard show/hide per word (which is what caused the flashing — see the
    // function's own comment), every overlapping word's alpha is dimmed
    // smoothly in proportion to how covered it is by something brighter.
    for (const c of applyOcclusion(frameCandidates(layout, p))) drawWord(c);
    ctx.globalAlpha = 1;
    drawHeader();
  }

  function frame(now: number) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    if (playing) {
      if (phase === "hold0") {
        dwell -= dt;
        if (dwell <= 0) phase = "distill";
      } else if (phase === "distill") {
        p = Math.min(1, p + dt / DISTILL_MS);
        if (p >= 1) {
          phase = "hold1";
          dwell = HOLD1_MS;
        }
      } else {
        dwell -= dt;
        if (dwell <= 0) {
          if (looping) {
            p = 0;
            phase = "hold0";
            dwell = HOLD0_MS;
          } else {
            playing = false;
          }
        }
      }
    }
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function restart() {
    p = 0;
    phase = "hold0";
    dwell = HOLD0_MS;
    playing = true;
  }

  function togglePlay() {
    if (!playing && p >= 1) restart();
    playing = !playing;
  }

  function onScrub(value: number) {
    p = value / 1000;
    playing = false;
    phase = p >= 1 ? "hold1" : "distill";
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === " " && (e.target as HTMLElement)?.tagName !== "INPUT") {
      e.preventDefault();
      togglePlay();
    }
  }

  function onPointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CLOUD_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CLOUD_HEIGHT;
    for (let i = hitTargets.length - 1; i >= 0; i--) {
      const t = hitTargets[i];
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) {
        hoveredLabel = t.label;
        return;
      }
    }
    hoveredLabel = null;
  }

  // Re-layout without restarting the story from scratch feels jarring on a
  // filter change — a fresh hold at Phase 1 makes the new word set legible.
  $effect(() => {
    void layout;
    restart();
  });

  onMount(() => {
    reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    resize();
    window.addEventListener("resize", resize);
    // Wait for the Noto webfonts to be ready before the first paint — canvas
    // text falls back silently otherwise, and unlike the DOM there's no
    // reflow once the real font arrives, just a permanently-wrong render.
    const start = () => {
      if (reduced) {
        playing = false;
        p = 1;
        phase = "hold1";
        draw();
      } else {
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    };
    if (document.fonts) document.fonts.ready.then(start);
    else start();
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
  });
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link
    href="https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@400;700&family=Noto+Sans:wght@400;600;700&family=Noto+Serif:wght@700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="controls-row">
  <Controls options={SCOPE_OPTIONS} activeIndex={scopeIndex} onSelect={(i) => (scope = SCOPE_OPTIONS[i].key)} ariaLabel="Phase 1 scope" />
  <Controls options={STRENGTH_OPTIONS} activeIndex={strengthIndex} onSelect={(i) => (minStrength = STRENGTH_OPTIONS[i].key)} ariaLabel="Edge filter" />
</div>

{#if crosswalk.meta.status === "proposed"}
  <div class="proposed-banner" role="status">
    Interpretive crosswalk — <strong>proposed, not yet reviewed</strong>.
  </div>
{/if}

<p class="legend-note">
  Phase 1 words are sized by respondent count; a theme raised on several
  fronts shows once, then splits into one fragment per concept it feeds, each
  sized by its own share — every edge is spent, nothing is silently dropped.
  Phase 2 words are sized by <em>sessions + top ideas</em>, never by vote
  share or by the Phase 1 counts absorbed into them — the two phases are
  never on one shared scale (see the alluvial view). Growth during the
  distill is a reveal of that mapping, not a measurement: no edge implies any
  respondent endorsed the concept it points to.
  <strong>Two kinds of gray, meaning opposite things:</strong> the gray words
  that fade out and vanish during the distill ({layout.unclaimedWords.length} at
  this filter) are Phase 1 themes no concept claims — they never carried
  forward. The faint gray-tinted words that sit still in Phase 2 from the
  start ({layout.targetWords.length - reachedCount} of {layout.targetWords.length})
  are the opposite: concepts no surviving theme reaches.
</p>

<div class="cloud-row">
  <div
    class="canvas-wrap"
    role="img"
    aria-label={`Animation in which Phase 1 survey themes distill into ${reachedCount} of ${layout.targetWords.length} Phase 2 policy concepts`}
  >
    <canvas
      bind:this={canvas}
      width={CLOUD_WIDTH}
      height={CLOUD_HEIGHT}
      aria-hidden="true"
      onpointermove={onPointerMove}
      onpointerleave={() => (hoveredLabel = null)}
    ></canvas>
    {#if hoveredLabel}
      <div class="hover-caption">{hoveredLabel}</div>
    {/if}
  </div>

  <ul class="legend-sidebar" aria-label="Color key — Phase 2 subtheme a word ultimately feeds">
    {#each rooms.subthemes as s, i}
      <li><span class="dot" style={`background: ${subthemeColors[i]}`}></span>{s.name}</li>
    {/each}
    <li class="gray">
      <span class="dot" style={`background: ${DATA_VIZ_NEUTRAL_LIGHT}`}></span>
      No subtheme — not carried forward, or not reached
    </li>
  </ul>
</div>

<div class="playback-row">
  <button type="button" onclick={togglePlay}>{playing ? "Pause" : "Play"}</button>
  <button type="button" onclick={restart}>Restart</button>
  <div class="scrub">
    <label for="distill-scrub">Distill</label>
    <input id="distill-scrub" type="range" min="0" max="1000" value={Math.round(p * 1000)} oninput={(e) => onScrub(+e.currentTarget.value)} />
  </div>
  <button type="button" aria-pressed={looping} onclick={() => (looping = !looping)}>Loop</button>
</div>

<style>
  :global(:root) {
    --dc-ink: #1e1e1e;
    --dc-gray: #444444;
    --dc-line: #dedee1;
    --dc-blue: #0d4f8c;
  }
  .controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .legend-note {
    font-family: "Noto Sans", Arial, sans-serif;
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--dc-gray);
    max-width: 50rem;
    margin: 0 0 1rem;
  }
  .legend-note em {
    color: var(--dc-blue);
    font-style: normal;
  }
  .proposed-banner {
    font-family: "Noto Sans", Arial, sans-serif;
    background: #fff3cd;
    color: #6b5300;
    border: 1px solid #e0c56a;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .cloud-row {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    max-width: 1420px;
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  /* Same swatch-then-label idea as the reference's own themeLegend() (a
     small filled circle, a gray Noto Sans label, no counts) — just laid out
     as a column beside the cloud instead of a row drawn under it, since a
     column reads better once there are 8 subthemes rather than 6 themes. */
  .legend-sidebar {
    list-style: none;
    margin: 40px 0 0;
    padding: 0;
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .legend-sidebar li {
    display: flex;
    align-items: baseline;
    gap: 9px;
    font-family: "Noto Sans", Arial, sans-serif;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--dc-gray);
  }
  .legend-sidebar li.gray {
    padding-top: 6px;
    border-top: 1px solid var(--dc-line);
  }
  .legend-sidebar .dot {
    width: 9px;
    height: 9px;
    min-width: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    transform: translateY(1px);
  }
  canvas {
    width: 100%;
    height: auto;
    display: block;
    background: #fff;
    border: 1px solid var(--dc-line);
    border-radius: 2px;
    cursor: default;
  }
  .hover-caption {
    position: absolute;
    left: 0;
    bottom: 100%;
    margin-bottom: 6px;
    font-family: "Noto Sans", Arial, sans-serif;
    background: var(--dc-ink);
    color: #fff;
    font-size: 0.78rem;
    padding: 0.35rem 0.6rem;
    border-radius: 2px;
    max-width: 90%;
    pointer-events: none;
  }
  .playback-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--dc-line);
    max-width: 1420px;
  }
  .scrub {
    flex: 1;
    min-width: 200px;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .scrub label {
    font-family: "Noto Sans Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--dc-gray);
    white-space: nowrap;
  }
  input[type="range"] {
    flex: 1;
    accent-color: var(--dc-blue);
    cursor: pointer;
  }
  .playback-row button {
    font-family: "Noto Sans Mono", ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--dc-gray);
    background: transparent;
    border: 1px solid var(--dc-line);
    border-radius: 2px;
    padding: 7px 12px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s,
      background 0.15s;
  }
  .playback-row button:hover {
    color: var(--dc-blue);
    border-color: var(--dc-blue);
  }
  .playback-row button:focus-visible {
    outline: 2px solid var(--dc-blue);
    outline-offset: 2px;
  }
  .playback-row button[aria-pressed="true"] {
    color: #fff;
    background: var(--dc-blue);
    border-color: var(--dc-blue);
  }
</style>
