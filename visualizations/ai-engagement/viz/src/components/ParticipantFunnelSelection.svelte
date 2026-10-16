<script lang="ts">
  /**
   * "Who participated" — a narrower sibling of
   * ParticipantFunnelCloud.svelte that plays only the funnel itself (Phase 1
   * -> Selected -> Phase 2 -> Conversations) and stops there, with its top
   * matter as real DOM (FunnelSectionHeader.svelte) instead of
   * ctx.fillText, matching the reference mockups. The two existing funnel
   * prototypes (ParticipantFunnelCloud.svelte, its Concepts sibling) are
   * left untouched — this is a separate, cut-down file, not a shared
   * refactor of either, so their own stage machines can't regress.
   *
   * funnelCloud.ts still does every placement/seeding decision; this file
   * only drives the animation clock and draws what that module computed,
   * same split as the two other funnel prototypes. funnelSection.ts holds
   * this file's own stage copy and header crossfade math, the same
   * pure-lib/component split.
   *
   * No `rooms`/`insights` props and nothing from deliberativeMoments.ts/
   * conversationPeek.ts/insightsData.ts/roomsRank.ts — this prototype never
   * reaches the conversation-peek or moments stages those modules serve, so
   * it doesn't fetch or depend on rooms.json at all.
   */
  import { onMount, onDestroy, untrack } from "svelte";
  import { buildFunnelCloud, dotTarget, type DotTarget, type FunnelData, type FunnelDimension, type FunnelDot, type MotionMode, CANVAS, CX, CY } from "../lib/funnelCloud.ts";
  import {
    SECTION_HEADING,
    buildSelectionStages,
    SELECTION_STAGE_COUNT,
    libStageFor,
    headerCrossfade,
    fmt,
    selectionStageBands,
    selectionYShift,
  } from "../lib/funnelSection.ts";
  import { PERSON_PATH, PERSON_BOX, personHeightFor } from "../lib/personGlyph.ts";
  import { assignCategoryColors, DATA_VIZ_CAT_OLD, DATA_VIZ_CAT_V2, DATA_VIZ_NEUTRAL_LIGHT } from "../lib/palette.ts";
  import { wrapLabel } from "../lib/labels.ts";
  import { watchEcTokens, type EcCanvasTokens } from "../lib/ecCanvasTokens.ts";
  import EcButton from "./ec/EcButton.svelte";
  import FunnelSectionHeader from "./FunnelSectionHeader.svelte";

  let { data }: { data: FunnelData & { meta: { sampleCaveat: string } } } = $props();

  const layout = $derived(buildFunnelCloud(data));
  const stages = $derived(buildSelectionStages(data));

  // The header's (i) tooltip body — elaborates the mockup's vague "based on
  // a variety of factors" line, then always ends on the real export's own
  // sample caveat (data.meta.sampleCaveat), so a claim broader than the raw
  // survey sample is never left unqualified even in a comms-styled header.
  const selectionInfoText = $derived(
    `Selection weighed factors like region, field of work, and other demographics to build a group broadly representative of respondents — not a random sample of every survey taker. ${data.meta.sampleCaveat}`,
  );

  const DIMENSION_OPTIONS: { key: FunnelDimension; label: string }[] = [
    { key: "region", label: "Region" },
    { key: "fieldOfWork", label: "Field of work" },
  ];
  let dimension = $state<FunnelDimension>("region");

  // Which ambient motion the conversation ring uses at the final stage — a
  // view toggle, not stage data, so it lives beside `dimension` rather than
  // in funnelCloud.ts (see funnelCloud.ts's MotionMode doc comment).
  const MOTION_OPTIONS: { key: MotionMode; label: string }[] = [
    { key: "orbit", label: "Orbit" },
    { key: "pulse", label: "Pulse" },
  ];
  let motion = $state<MotionMode>("orbit");

  const categories = $derived(dimension === "region" ? data.regions : data.fieldOfWork);

  // Dev-only: lets us A/B the reordered EC design-system "Data Viz" ramp
  // ("Engaged", DATA_VIZ_CAT_V2) against the old hand-picked ODI one
  // (DATA_VIZ_CAT_OLD) while reviewing this view — never exposed as a real
  // user-facing control (see the toggle's own template comment below).
  // Remove once the palette review is settled; DATA_VIZ_CAT_OLD/
  // DATA_VIZ_CAT_V2 only exist for this comparison.
  let paletteVersion = $state<"engaged" | "odi">("engaged");
  const PALETTE_RAMPS = { engaged: DATA_VIZ_CAT_V2, odi: DATA_VIZ_CAT_OLD };
  const categoryColors = $derived(assignCategoryColors(categories.map((c) => c.name), PALETTE_RAMPS[paletteVersion]));
  const colorOf = $derived(new Map(categories.map((c, i) => [c.name, categoryColors[i]])));

  // EC design-system colors, resolved from the CSS custom properties in
  // styles/ec-tokens.css (see ecCanvasTokens.ts) rather than hardcoded here
  // a second time — canvas draw calls can't read var(--…) directly, so this
  // is the one place that gap gets bridged, seeded with the light-theme
  // values as a pre-mount fallback and refreshed by watchEcTokens below.
  // Only the fields this stripped-down prototype's canvas draw calls
  // actually use get their own named const below (SURFACE/INK/GRAY/NEUTRAL/
  // DROPPED_COLOR) — no ring outline or badge ever draws here, so this file
  // has no ACCENT/OUTLINE the way ParticipantFunnelCloud.svelte does.
  let ecTokens = $state<EcCanvasTokens>({
    surface: "#ffffff",
    onSurface: "#1c2745",
    onSurfaceMuted: "#444444",
    hairline: "#d4d4d7",
    emphasis: "#1c2745",
    link: "#0d5d90",
    nondata: "#3b3a48",
    dropped: "#d3d3d3",
    graphicHairline: "#8c8c8c",
  });
  const SURFACE = $derived(ecTokens.surface);
  const INK = $derived(ecTokens.onSurface);
  const GRAY = $derived(ecTokens.onSurfaceMuted);
  const NEUTRAL = $derived(ecTokens.nondata);
  const DROPPED_COLOR = $derived(ecTokens.dropped);
  const WORD_FONT = "'Noto Sans', Arial, sans-serif";

  // The canvas's own top ~120px used to hold header()'s ctx.fillText copy;
  // that's now FunnelSectionHeader.svelte, real DOM above #stage, so the
  // canvas element itself is shrunk by this amount (see resize()) rather
  // than left with an empty band. Every other draw call keeps its existing
  // absolute-canvas-space coordinates (funnelCloud.ts's CLOUD_Y/NECK_Y/
  // GATHER_Y/CY, categoryLegend()'s CANVAS.H - 58, …) — resize()'s transform
  // shifts the *visible* window over that same coordinate space instead of
  // moving the coordinates themselves, so none of those tuned constants (or
  // funnelCloud.test.ts, which never touches this file) need to change.
  const TOP_TRIM = 120;

  // The viewport's own bottom edge is trimmed too, reclaiming the dead space
  // below the category legend that was left once every stage got vertically
  // centered (see yShift below) rather than sitting at CLOUD_Y/GATHER_Y/CY's
  // original, uncentered heights. BOTTOM_TRIM is a visual tuning constant,
  // not derived — it's the floor the conversation ring's own size allows
  // (see funnelSection.ts's selectionStageBands doc comment); push it
  // further only after shrinking the ring itself.
  const BOTTOM_TRIM = 56;
  const VIEW_TOP = TOP_TRIM;
  const VIEW_BOTTOM = CANVAS.H - BOTTOM_TRIM;
  const VIEW_H = VIEW_BOTTOM - VIEW_TOP;
  // The bottom band reserved for the Participant/Facilitator key plus up to
  // 2 category-legend rows (categoryLegend() below) — dot content is centered
  // above this band, not across the whole viewport, so the ring/cloud/gather
  // never draw underneath the legend.
  const BAND_H = 100;
  const DOT_TOP = VIEW_TOP + 6;
  const DOT_BOTTOM = VIEW_BOTTOM - BAND_H;

  // Per-SELECTION_STAGE vertical offset that puts every stage's dot content
  // (cloud, gather, ring) on the same center line within [DOT_TOP,
  // DOT_BOTTOM] — see funnelSection.ts's selectionStageBands/selectionYShift.
  // Applied inside targetFor() below, once per dotTarget() call, rather than
  // touching funnelCloud.ts's CLOUD_Y/GATHER_Y/CY (shared with
  // ParticipantFunnelCloud.svelte and friends).
  const bands = $derived(selectionStageBands(layout));
  const yShift = $derived(selectionYShift(bands, DOT_TOP, DOT_BOTTOM));

  const DWELL_MS = 1900;
  const TRANSITION_MS = 2600;
  const ORBIT_SPEED = 0.2;
  const DRIFT_SPEED = 0.3;

  interface RenderDot {
    pos: [number, number];
    from: [number, number];
    alpha: number;
    aFrom: number;
    r: number;
    rFrom: number;
    cNow: [number, number, number];
    cFrom: [number, number, number];
    delay: number;
    // 0-1 "this dot is a person, not a dot" amount — tweened per-dot, on the
    // same staggered `delay` as alpha/r/cNow above, so a stage change morphs
    // dots into people (or back) with the same stagger as everything else
    // about that transition. Only ever non-zero entering/leaving the Phase 2
    // stage, the one stage that draws person glyphs.
    person: number;
    pFrom: number;
  }

  let renders: RenderDot[] = [];
  let clock = 0;
  let stage = $state(0);
  // Stays false while dots are still migrating into the final stage's ring,
  // so the ring-center title only fades in once they've actually landed,
  // rather than appearing mid-flight. Not $state since nothing in the
  // template reads it.
  let ringReady = false;
  let prevStage = 0;
  let t = 1;
  let playing = $state(true);
  let looping = $state(true);
  let dwellLeft = DWELL_MS;
  let reduced = false;
  let rafId = 0;
  let lastTime = 0;
  // Eased 0-1 visibility of the ring-center headcount title — ramps to 1 on
  // arrival at the final "Conversations" stage and back to 0 everywhere
  // else, so it fades in/out instead of popping with the stage switch.
  let titleK = 0;
  const TITLE_EASE_MS = 900;

  // The DOM header's own crossfade state — updated once a frame from
  // funnelSection.ts's headerCrossfade(t), so FunnelSectionHeader.svelte
  // tracks the same stage-transition curve the dots move on without
  // re-deriving it itself.
  let headerOpacity = $state(1);
  let headerStageIndex = $state(0);

  // Built once, not per frame — Path2D is immutable and every dot stamp
  // reuses this same instance under its own ctx.translate/scale.
  const PERSON = new Path2D(PERSON_PATH);

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Accepts both a literal "#rrggbb" (palette.ts's hex hues) and a resolved
  // "rgb(r, g, b)"/"rgba(r, g, b, a)" string (ecCanvasTokens.ts's
  // DROPPED_COLOR, resolved via getComputedStyle rather than kept as a hex
  // literal — see readEcTokens's own comment for why).
  function toRGB(color: string): [number, number, number] {
    if (color.startsWith("#")) {
      return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    }
    const m = color.match(/[\d.]+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
  }
  const rgbCache = new Map<string, [number, number, number]>();
  function rgb(color: string): [number, number, number] {
    let v = rgbCache.get(color);
    if (!v) {
      v = toRGB(color);
      rgbCache.set(color, v);
    }
    return v;
  }
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const mixColor = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [
    lerp(a[0], b[0], k),
    lerp(a[1], b[1], k),
    lerp(a[2], b[2], k),
  ];
  const css = (c: [number, number, number]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function colorFor(categoryKey: string): [number, number, number] {
    if (categoryKey === "__dropped") return rgb(DROPPED_COLOR);
    return rgb(colorOf.get(categoryKey) ?? DATA_VIZ_NEUTRAL_LIGHT);
  }

  // Stamps the shared PERSON path centered at (cx, cy), scaled so its own
  // height (PERSON_BOX.h) becomes `height` canvas px. Used by the Phase-2
  // participant dots' draw() call — every caller supplies its own fillStyle
  // first.
  function stampPerson(cx: number, cy: number, height: number) {
    if (!ctx) return;
    const s = height / PERSON_BOX.h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-PERSON_BOX.cx, -PERSON_BOX.cy);
    ctx.fill(PERSON);
    ctx.restore();
  }

  function resetRenders() {
    renders = layout.dots.map((dot) => {
      const g = targetFor(dot, stage);
      const c = colorFor(g.categoryKey);
      const p = g.person ? 1 : 0;
      return { pos: [g.x, g.y], from: [g.x, g.y], alpha: g.alpha, aFrom: g.alpha, r: g.r, rFrom: g.r, cNow: c, cFrom: c, delay: 0, person: p, pFrom: p };
    });
  }

  function place(dot: FunnelDot, render: RenderDot, g: ReturnType<typeof dotTarget>, lt: number) {
    if (g.viaX !== undefined && g.viaY !== undefined) {
      const u = 1 - lt;
      render.pos[0] = u * u * render.from[0] + 2 * u * lt * g.viaX + lt * lt * g.x;
      render.pos[1] = u * u * render.from[1] + 2 * u * lt * g.viaY + lt * lt * g.y;
    } else {
      render.pos[0] = lerp(render.from[0], g.x, lt);
      render.pos[1] = lerp(render.from[1], g.y, lt);
    }
  }

  // Wraps dotTarget() with this section's own vertical centering (yShift) —
  // every call site below used to call dotTarget() directly with identical
  // arguments; this is that one call, with the section-stage's shift folded
  // into `y`/`viaY` so the rest of the file (place(), the idle-refresh loop)
  // never needs to know centering happens at all.
  function targetFor(dot: FunnelDot, sectionStage: number): DotTarget {
    const g = dotTarget(dot, libStageFor(sectionStage), dimension, layout.clusters, clock, DRIFT_SPEED, ORBIT_SPEED, motion, "invited");
    const dy = yShift[sectionStage] ?? 0;
    if (!dy) return g;
    return { ...g, y: g.y + dy, viaY: g.viaY === undefined ? undefined : g.viaY + dy };
  }

  const LAST_STAGE = SELECTION_STAGE_COUNT - 1;

  // The ring's actual shifted bottom edge, in canvas-space — bands[LAST_STAGE]
  // is the ring's own unshifted extent (funnelSection.ts's
  // selectionStageBands), so adding its stage's own yShift lands on exactly
  // where the ring now draws, rather than assuming it lines up with
  // DOT_BOTTOM (the *target* band bottom every stage centers into, which the
  // ring's real height doesn't necessarily match exactly).
  const ringBottomY = $derived(bands[LAST_STAGE].bottom + (yShift[LAST_STAGE] ?? 0));
  // Set from inside categoryLegend() (canvas-space y of that legend's first
  // row) — $state, not a plain let, so writing it from draw()'s per-frame
  // canvas pass still notifies the .dimension-toggle binding below. Only
  // ever changes when `categories`/`dimension` changes the row count, so in
  // practice this is a no-op write on every other frame.
  let legendTopY = $state(CANVAS.H - 58);
  // The Participant/Facilitator key's own y — centered in the gap between
  // the ring's bottom and the category legend's first row, whatever that
  // gap's size (facilitators() below reads this for `ly`; the
  // dimension-toggle CSS binding below reads it too, so the toggle and the
  // key sit on one line).
  const keyRowY = $derived((ringBottomY + legendTopY) / 2);
  // .dimension-toggle's CSS `bottom` is a % of #stage's rendered height,
  // which tracks VIEW_H 1:1 (see canvas's width:100%/height:auto + #stage
  // having no other height driver) — converting keyRowY into that
  // percentage, plus `transform: translateY(50%)` in the stylesheet, is what
  // keeps the toggle level with the key row instead of the old fixed 11.73%
  // tuned for the pre-centering layout.
  const dimensionTogglePct = $derived(((VIEW_BOTTOM - keyRowY) / VIEW_H) * 100);

  function goTo(nextStage: number) {
    if (nextStage === stage && t >= 1) return;
    prevStage = stage;
    stage = nextStage;
    // The final stage holds indefinitely (see dwellFor) regardless of Loop,
    // but switch the toggle itself off on arrival so its pressed state
    // doesn't keep promising a loop that dwellFor's Infinity will never
    // trigger.
    if (nextStage === LAST_STAGE) looping = false;
    t = reduced ? 1 : 0;
    ringReady = nextStage === LAST_STAGE && reduced;
    layout.dots.forEach((dot, i) => {
      const r = renders[i];
      r.from = [r.pos[0], r.pos[1]];
      r.aFrom = r.alpha;
      r.rFrom = r.r;
      r.cFrom = r.cNow;
      r.pFrom = r.person;
      r.delay = (dot.kept ? 0 : 0.1) + Math.random() * (dot.kept ? 0.22 : 0.3);
    });
    if (reduced) snapValues();
  }

  function snapValues() {
    layout.dots.forEach((dot, i) => {
      const g = targetFor(dot, stage);
      const r = renders[i];
      r.pos = [g.x, g.y];
      r.alpha = g.alpha;
      r.r = g.r;
      r.cNow = colorFor(g.categoryKey);
      r.person = g.person ? 1 : 0;
    });
  }

  // The final "Conversations" stage holds forever once reached — clock and
  // orbit keep running (dwellLeft just never reaches 0), but auto-advance
  // and looping both stop there so the ring settles and the "scroll down"
  // prompt stays put rather than looping back to Phase 1 on its own.
  const dwellFor = (s: number) => (s === LAST_STAGE ? Infinity : DWELL_MS);

  function facilitators() {
    if (!ctx) return;
    const vis = stage === LAST_STAGE ? easeInOut(Math.max(0, (t - 0.45) / 0.55)) : 0;
    if (vis <= 0.01) return;

    // Guaranteed LAST_STAGE here (vis is 0, and we've already returned,
    // everywhere else) — same shift targetFor() folds into the dots
    // themselves at this stage, applied here too since these bullseyes are
    // drawn independently of the dot loop.
    const ringShift = yShift[LAST_STAGE] ?? 0;
    layout.clusters.forEach((cl) => {
      const cy = cl.y + ringShift;
      ctx!.globalAlpha = vis;
      ctx!.beginPath();
      ctx!.arc(cl.x, cy, 11, 0, Math.PI * 2);
      ctx!.fillStyle = SURFACE;
      ctx!.fill();
      ctx!.beginPath();
      ctx!.arc(cl.x, cy, 7.5, 0, Math.PI * 2);
      ctx!.fillStyle = NEUTRAL;
      ctx!.fill();
      ctx!.beginPath();
      ctx!.arc(cl.x, cy, 3, 0, Math.PI * 2);
      ctx!.fillStyle = SURFACE;
      ctx!.fill();
    });
    ctx.lineWidth = 1;

    // The Participant/Facilitator key — centered as one unit (mockup match),
    // not left-aligned like categoryLegend() below it. Measure the wider
    // label first so the whole row (dot + gap + label + donut + gap + label)
    // can be centered together; 125 is the fixed glyph/gap geometry the
    // drawing below actually uses (5 + 12 + measureText("Participant")'s own
    // width isn't part of this since "Participant" happens to be shorter
    // than the fixed 108px column it sits in — only "Facilitator"'s width
    // varies the row's total footprint).
    ctx.globalAlpha = vis;
    ctx.font = `400 14px ${WORD_FONT}`; // DS --ec-text-caption
    const facilitatorWidth = ctx.measureText("Facilitator").width;
    const rowWidth = 125 + facilitatorWidth;
    const lx = (CANVAS.W - rowWidth) / 2 + 5;
    // Vertical position only — centered in the gap this row now has to
    // itself (between the ring and the category legend's first row), rather
    // than the old fixed CANVAS.H - 108. lx/rowWidth above are untouched.
    const ly = keyRowY;

    ctx.fillStyle = GRAY;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = SURFACE;
    ctx.fill();
    ctx.fillStyle = GRAY;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Participant", lx + 12, ly);
    ctx.fillText("Facilitator", lx + 120, ly);

    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  // The ring-center headcount ("N people in M conversations") plus the
  // "scroll down" invitation — fades in (via titleK) on arrival at the final
  // stage, and stays until the animation leaves it (Restart, or jumping back
  // to an earlier stage).
  function curtainCenterLabel() {
    if (!ctx || titleK <= 0.01) return;
    const maxClusterRc = Math.max(...layout.clusters.map((c) => c.rc), 0);
    const freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    const maxWidth = freeRadius * 1.7;
    const lineHeight = 22;
    const gap = 6;

    const countLines = wrapLabel(`${fmt(layout.keptTotal)} people in ${fmt(layout.clusters.length)} conversations`, maxWidth, 8.9).slice(0, 2);
    const promptLines = wrapLabel("Scroll down to see the power of the discussions", maxWidth, 7.8).slice(0, 2);
    const totalHeight = countLines.length * lineHeight + gap + promptLines.length * lineHeight;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Only ever shown at LAST_STAGE (titleK ramps to 0 everywhere else), so
    // the ring's own shift (yShift[LAST_STAGE], same one facilitators()
    // applies to the cluster bullseyes) is the right offset here too.
    const ringCenterY = CY + (yShift[LAST_STAGE] ?? 0);
    let y = ringCenterY - totalHeight / 2 + lineHeight / 2;

    ctx.globalAlpha = titleK;
    ctx.font = `700 16px ${WORD_FONT}`;
    ctx.fillStyle = INK;
    countLines.forEach((line) => {
      ctx!.fillText(line, CX, y);
      y += lineHeight;
    });

    y += gap;
    ctx.font = `400 14px ${WORD_FONT}`;
    ctx.fillStyle = GRAY;
    promptLines.forEach((line) => {
      ctx!.fillText(line, CX, y);
      y += lineHeight;
    });

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function categoryLegend() {
    if (!ctx) return;
    ctx.font = `400 14px ${WORD_FONT}`; // DS --ec-text-caption
    ctx.textBaseline = "middle";
    const SW = 9,
      GAP = 7,
      PAD = 22;
    const w = categories.map((c) => SW + GAP + ctx!.measureText(c.name).width + PAD);

    const total = w.reduce((a, b) => a + b, 0);
    const nRows = Math.max(1, Math.ceil(total / (CANVAS.W - 90)));
    const target = total / nRows;
    const rows: number[][] = [[]];
    let cur = 0;
    w.forEach((wd, i) => {
      if (rows.length < nRows && cur + wd / 2 > target && rows[rows.length - 1].length) {
        rows.push([]);
        cur = 0;
      }
      rows[rows.length - 1].push(i);
      cur += wd;
    });

    // Left-aligned (mockup match) — every row starts at the same x=60 margin
    // FunnelSectionHeader.svelte's own DOM copy uses (5.77% of CANVAS.W),
    // rather than each row separately centering itself the way
    // ParticipantFunnelCloud.svelte's categoryLegend() still does.
    //
    // Anchored bottom-up from the trimmed viewport's own bottom edge
    // (VIEW_BOTTOM), not the untrimmed CANVAS.H: the *last* row sits a fixed
    // 22px above VIEW_BOTTOM and earlier rows stack upward from there, so a
    // taller legend (more rows, e.g. Field of work) grows into the
    // reclaimed headroom above it instead of running off the shortened
    // canvas's bottom edge the way the old top-down anchor (CANVAS.H - 58,
    // +24 per row) would have. legendTopY (read by facilitators() above, for
    // the key row's own position) is this loop's first row y.
    legendTopY = VIEW_BOTTOM - 22 - 24 * (rows.length - 1);
    let y = legendTopY;
    for (const row of rows) {
      let x = 60;
      for (const i of row) {
        ctx.beginPath();
        ctx.arc(x + SW / 2, y, SW / 2, 0, Math.PI * 2);
        ctx.fillStyle = categoryColors[i];
        ctx.fill();
        ctx.fillStyle = GRAY;
        ctx.textAlign = "left";
        ctx.fillText(categories[i].name, x + SW + GAP, y);
        x += w[i];
      }
      y += 24;
    }
    ctx.textBaseline = "alphabetic";
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, VIEW_TOP, CANVAS.W, VIEW_H);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, VIEW_TOP, CANVAS.W, VIEW_H);

    for (let i = 0; i < layout.dots.length; i++) {
      const r = renders[i];
      if (!r || r.alpha <= 0.008) continue;
      ctx.fillStyle = css(r.cNow);

      // p is this dot's own morph amount, staggered per-dot by the stage
      // transition (see `person`/`pFrom` on RenderDot). Crossfading the two
      // marks by alpha, while the glyph's own height also lerps from the
      // dot's diameter up to its full person height, is what makes a dot
      // look like it's growing into a figure rather than one hard-swapping
      // for the other — used only entering/leaving the Phase 2 stage, the
      // one stage that draws person glyphs.
      const p = r.person;
      if (p < 0.999) {
        ctx.globalAlpha = r.alpha * (1 - p);
        ctx.beginPath();
        ctx.arc(r.pos[0], r.pos[1], r.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p > 0.001) {
        ctx.globalAlpha = r.alpha * p;
        stampPerson(r.pos[0], r.pos[1], lerp(2 * r.r, personHeightFor(r.r), p));
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // categoryLegend() runs first — it sets legendTopY, which facilitators()
    // reads (for the key row's own y) in the same frame. Painting order is
    // unaffected: none of these three overlap on canvas.
    categoryLegend();
    facilitators();
    curtainCenterLabel();
  }

  function frame(now: number) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    const cross = headerCrossfade(t);
    headerOpacity = cross.opacity;
    headerStageIndex = cross.useTo ? stage : prevStage;

    const titleTarget = stage === LAST_STAGE && ringReady ? 1 : 0;
    titleK += (titleTarget - titleK) * Math.min(1, dt / TITLE_EASE_MS);

    if (playing) {
      clock += dt / 1000;

      if (t < 1) {
        t = Math.min(1, t + dt / TRANSITION_MS);
        const span = 0.7;
        layout.dots.forEach((dot, i) => {
          const g = targetFor(dot, stage);
          const r = renders[i];
          const lt = easeInOut(Math.max(0, Math.min(1, (t - r.delay) / span)));
          place(dot, r, g, lt);
          r.alpha = lerp(r.aFrom, g.alpha, lt);
          r.r = lerp(r.rFrom, g.r, lt);
          r.cNow = mixColor(r.cFrom, colorFor(g.categoryKey), lt);
          r.person = lerp(r.pFrom, g.person ? 1 : 0, lt);
        });
        if (t >= 1) {
          dwellLeft = dwellFor(stage);
          if (stage === LAST_STAGE) ringReady = true;
        }
      } else {
        dwellLeft -= dt;
        if (dwellLeft <= 0) {
          if (stage < LAST_STAGE) goTo(stage + 1);
          else if (looping) goTo(0);
          else playing = false;
        }
      }
    }

    // The Phase 2 (gather) stage has no continuous drift/orbit of its own
    // (the gathered cohort just sits still), but it still needs this loop
    // to run — this is the only thing that re-reads `dimension` while idle
    // (see the cNow comment below), and skipping it left it stuck on
    // whichever color was current the last time a real stage transition
    // passed through it. Every valid stage needs it, so the condition just
    // checks `t`.
    if (t >= 1) {
      layout.dots.forEach((dot, i) => {
        if (stage === LAST_STAGE && !dot.kept) return;
        const g = targetFor(dot, stage);
        renders[i].pos[0] = g.x;
        renders[i].pos[1] = g.y;
        // Also refresh color here, not just position — cNow otherwise only
        // gets recomputed inside the t<1 transition branch above, so
        // toggling the Region/Field of work dimension while idle (no stage
        // change in flight) silently did nothing until the next real
        // transition recolored every dot as a side effect.
        renders[i].cNow = colorFor(g.categoryKey);
      });
    }

    draw();
    rafId = requestAnimationFrame(frame);
  }

  function restart() {
    clock = 0;
    stage = 0;
    prevStage = 0;
    t = 1;
    ringReady = false;
    resetRenders();
    dwellLeft = DWELL_MS;
    playing = true;
  }

  function togglePlay() {
    playing = !playing;
    if (playing && t >= 1 && stage === LAST_STAGE && !looping) restart();
  }

  function jumpTo(s: number) {
    goTo(s);
    dwellLeft = dwellFor(stage);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight" && stage < LAST_STAGE) {
      jumpTo(stage + 1);
    } else if (e.key === "ArrowLeft" && stage > 0) {
      jumpTo(stage - 1);
    }
  }

  function resize() {
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || CANVAS.W;
    const scale = cssWidth / CANVAS.W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS.W * scale * dpr;
    canvas.height = VIEW_H * scale * dpr;
    canvas.style.height = `${VIEW_H * scale}px`;
    ctx = canvas.getContext("2d");
    // Shifts the visible window up by VIEW_TOP canvas-space px (in device
    // pixels: VIEW_TOP * scale * dpr) rather than translating every draw
    // call's own coordinates — see TOP_TRIM's doc comment above. The bottom
    // trim needs no translate of its own: shrinking canvas.height already
    // clips anything below VIEW_BOTTOM.
    ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, -VIEW_TOP * scale * dpr);
  }

  // Runs once, whenever `layout` itself changes (only happens once, when
  // `data` first resolves) — never again after that, since `data` is never
  // reassigned. restart() incidentally reads `stage`/`dimension` (through
  // resetRenders -> dotTarget) to seed initial render state; without
  // untrack(), that read would make THIS effect depend on `stage` too, so
  // every later `goTo()` inside the animation loop (a plain state write,
  // not related to `layout` at all) would re-fire this effect and snap the
  // whole animation back to stage 0 — exactly the "never advances past
  // Phase 1" bug this comment is here to prevent regressing (see
  // ParticipantFunnelCloud.svelte's identical guard).
  $effect(() => {
    void layout;
    untrack(() => restart());
  });

  let stopWatchingEcTokens: (() => void) | null = null;

  onMount(() => {
    reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    resize();
    window.addEventListener("resize", resize);
    // Reads the resolved --ec-* custom properties off the canvas itself
    // (they cascade down from :root in styles/ec-tokens.css) and re-reads
    // on every light/dark flip — see ecCanvasTokens.ts. draw() already
    // runs every animation frame, so a token change just repaints with the
    // new values on the very next frame with no extra invalidation.
    stopWatchingEcTokens = watchEcTokens(canvas, (tokens) => {
      ecTokens = tokens;
    });
    const start = () => {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    };
    if (document.fonts) document.fonts.ready.then(start);
    else start();
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    stopWatchingEcTokens?.();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="funnel-cloud">
  <FunnelSectionHeader heading={SECTION_HEADING} stage={stages[headerStageIndex]} opacity={headerOpacity} infoText={selectionInfoText} />

  <div id="stage">
    <canvas
      bind:this={canvas}
      width={CANVAS.W}
      height={VIEW_H}
      aria-label={`Animation showing ${fmt(layout.phase1Total)} phase one participants, ${fmt(layout.invitedTotal)} of whom were invited to participate in discussions, funnelling down to ${layout.keptTotal} who attended, who then separate into ${layout.clusters.length} conversation groups arranged in a ring, colored by ${dimension === "region" ? "region" : "field of work"}. The phase 2 cohort is shown as a person figure, one per attendee, only as it gathers; the final conversation stage shows each attendee as a plain dot, ${motion === "orbit" ? "rotating steadily around its conversation's center" : "slowly rotating while drifting closer to and farther from its conversation's center, breathing in and out"}.`}
    ></canvas>

    <div class="dimension-toggle" role="group" aria-label="Color dots by" style="bottom: {dimensionTogglePct}%">
      {#each DIMENSION_OPTIONS as opt}
        <button type="button" class="dimension-option" aria-pressed={dimension === opt.key} onclick={() => (dimension = opt.key)}>
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="controls">
    <EcButton variant="primary" onclick={togglePlay}>{playing ? "Pause" : "Play"}</EcButton>
    <EcButton variant="outline" onclick={restart}>Restart</EcButton>
    <div class="spacer"></div>
    {#each stages as s, i (s.pill)}
      <EcButton variant="pill" pressed={stage === i} onclick={() => jumpTo(i)}>{s.pill}</EcButton>
    {/each}
    <EcButton variant="pill" pressed={looping} onclick={() => (looping = !looping)}>Loop</EcButton>
    {#each MOTION_OPTIONS as opt}
      <EcButton variant="pill" pressed={motion === opt.key} onclick={() => (motion = opt.key)}>{opt.label}</EcButton>
    {/each}
  </div>

  <p class="hint">
    Toggle between Region and Field of work to recolor the same {layout.keptTotal} real phase 2 attendees by a
    different demographic — the set of people highlighted never changes, only what distinguishes them. {data.meta.sampleCaveat}
  </p>

  <!-- Dev-only palette A/B for reviewing the reordered EC "Data Viz" ramp
       (Engaged) against the old hand-picked one (ODI) — not a real setting,
       so it's set off visually (dashed hairline, caption type) from the
       controls/hint copy above rather than styled like another EcButton
       row. Delete along with paletteVersion/DATA_VIZ_CAT_OLD/
       DATA_VIZ_CAT_V2 once the review is done. -->
  <div class="dev-palette-toggle">
    <span>Dev only — color palette review:</span>
    <button type="button" class:active={paletteVersion === "engaged"} onclick={() => (paletteVersion = "engaged")}>Engaged</button>
    <button type="button" class:active={paletteVersion === "odi"} onclick={() => (paletteVersion = "odi")}>ODI</button>
  </div>
</div>

<style>
  .funnel-cloud {
    font-family: var(--ec-font-sans);
    color: var(--ec-on-surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }

  #stage {
    width: 100%;
    max-width: 1040px;
    position: relative;
  }

  canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  /* Bottom-left (mockup match), not centered like
     ParticipantFunnelCloud.svelte's dimension-toggle — left edge lines up
     with FunnelSectionHeader's own 5.77% padding and categoryLegend()'s
     x=60 margin. `bottom` is set inline from the component's own
     dimensionTogglePct — the Participant/Facilitator key's y (keyRowY),
     converted to a % of #stage's rendered height (which tracks VIEW_H 1:1),
     so the toggle stays level with that key row instead of a fixed
     percentage tuned for one specific layout. translateY(50%) makes the
     percentage refer to this element's own vertical center rather than its
     bottom edge, so it lines up on keyRowY regardless of the toggle's own
     (font-driven) height. */
  .dimension-toggle {
    position: absolute;
    left: 5.77%;
    transform: translateY(50%);
    display: inline-flex;
    border-radius: var(--ec-pill-radius);
    overflow: hidden;
    border: 1px solid var(--ec-navy);
  }

  /* A single joined segmented control (mockup match) rather than two
     separate pills — EcButton's own pill variant can't express a joined
     pair sharing one border, so this is a local, one-off pair of plain
     buttons instead of two EcButton instances. */
  .dimension-option {
    font: inherit;
    font-family: var(--ec-font-sans);
    font-size: var(--ec-text-caption);
    font-weight: var(--ec-weight-semibold);
    padding: 6px 16px;
    border: none;
    cursor: pointer;
    background: var(--ec-surface-alt);
    color: var(--ec-link);
  }

  .dimension-option[aria-pressed="true"] {
    background: var(--ec-navy);
    color: var(--ec-text-light);
  }

  .dimension-option:focus-visible {
    outline: 2px solid var(--ec-link);
    outline-offset: -2px;
  }

  .controls {
    width: 100%;
    max-width: 1040px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--ec-hairline);
  }

  .spacer {
    flex: 1;
  }

  .hint {
    width: 100%;
    max-width: 1040px;
    font-size: var(--ec-text-body-sm);
    line-height: 1.55;
    color: var(--ec-on-surface-muted);
    margin: 0;
  }

  /* Deliberately plain — not an EcButton/EcCard — so this reads as an
     internal review affordance, not a feature the app is offering a
     visitor. */
  .dev-palette-toggle {
    width: 100%;
    max-width: 1040px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--ec-hairline);
    font-size: var(--ec-text-xs);
    color: var(--ec-on-surface-muted);
  }

  .dev-palette-toggle button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid var(--ec-hairline);
    border-radius: var(--ec-radius-sm);
    padding: 2px 8px;
    cursor: pointer;
  }

  .dev-palette-toggle button.active {
    color: var(--ec-on-surface);
    border-color: var(--ec-on-surface);
    font-weight: var(--ec-weight-semibold);
  }

  @media (max-width: 640px) {
    .spacer {
      display: none;
    }
  }
</style>
