<script lang="ts">
  /**
   * Ports sketches/participant-funnel-region/participant-funnel-cloud-region.html onto real
   * data: phase 1 survey respondents drifting as a cloud, funneling down
   * into the real phase 2 attendees, then seating them in their real
   * conversation sessions. funnelCloud.ts does every placement/seeding
   * decision (including the region/field-of-work joint-consistency rule
   * documented there) — this file only drives the animation clock and
   * draws what that module computed, same split as DistillCloud.svelte/
   * cloud.ts.
   *
   * A toggle the reference sketch didn't have: which dimension colors the
   * dots and drives the legend, Region or Field of work. Toggling never
   * recomputes layout — the same dots, same positions, same "kept" set,
   * just a different categoryKey per funnelCloud.ts's dotTarget().
   *
   * Typography/chrome/non-categorical colors were brought onto the
   * Engaged California design system (design/Engaged California Design
   * System.zip) in a later pass — see the EC token constants below and the
   * ec/ component imports. Dot colors deliberately stayed on palette.ts's
   * own CVD-validated ramp rather than the DS's 8-hue dataviz palette,
   * which can't cover this view's 9-15 categories at an all-pairs-safe
   * distance; see palette.ts's own header for that constraint.
   */
  import { onMount, onDestroy, untrack } from "svelte";
  import {
    buildFunnelCloud,
    dotTarget,
    type FunnelData,
    type FunnelDimension,
    type FunnelDot,
    type MotionMode,
    CANVAS,
    RING_SHIFT_X,
    PULSE_AMPLITUDE,
    CX,
    CY,
    type Cluster,
  } from "../lib/funnelCloud.ts";
  import { PERSON_PATH, PERSON_BOX, personHeightFor } from "../lib/personGlyph.ts";
  import {
    buildMomentGroups,
    displayNameFor,
    cardQuotesFor,
    type MomentConcept,
    type MomentSession,
    type MomentAttendee,
  } from "../lib/deliberativeMoments.ts";
  import { buildConversationPeeks, type ConversationPeek } from "../lib/conversationPeek.ts";
  import type { RoomsData } from "../lib/roomsData.ts";
  import type { PopularityBin } from "../lib/roomsRank.ts";
  import type { InsightsData } from "../lib/insightsData.ts";
  import { assignCategoryColors, DATA_VIZ_CAT_OLD, DATA_VIZ_CAT_V2, DATA_VIZ_NEUTRAL_LIGHT } from "../lib/palette.ts";
  import { wrapLabel } from "../lib/labels.ts";
  import { watchEcTokens, type EcCanvasTokens } from "../lib/ecCanvasTokens.ts";
  import EcButton from "./ec/EcButton.svelte";
  import EcCard from "./ec/EcCard.svelte";
  import EcGlyph from "./ec/EcGlyph.svelte";
  import EcStatusPill from "./ec/EcStatusPill.svelte";
  import ConversationPeekCard from "./ConversationPeekCard.svelte";

  let { data, rooms, insights = null }: { data: FunnelData & { meta: { sampleCaveat: string } }; rooms: RoomsData; insights?: InsightsData | null } =
    $props();

  // insights.json is optional (hand-authored comms copy, not a stage
  // export — see insightsData.ts) — a concept absent from it, or a missing
  // file entirely, falls back to placeholder copy everywhere below.
  function insightOf(conceptId: string) {
    return insights?.concepts[conceptId];
  }

  const layout = $derived(buildFunnelCloud(data));

  // Stage 5 ("Deliberative moments") data — every rooms.json concept,
  // grouped into popularity bins and joined to this layout's own clusters.
  // See deliberativeMoments.ts's header comment for why this is the one
  // place funnel and rooms data are allowed to meet.
  const momentGroups = $derived(buildMomentGroups(rooms, layout.clusters));
  const allMomentConcepts = $derived(momentGroups.flatMap((g) => g.concepts));

  // Bin identity (badge number + color) — a fixed 4-way scheme independent
  // of the shared demographic palette (assignCategoryColors), since these
  // colors label the popularity bins themselves, not a data category. Kept
  // small and local rather than promoted to palette.ts since nothing else
  // in viz/ uses a "bin" concept.
  //
  // Now sourced from EC brand hues (navy / blue-mid / orange-dark /
  // border-mid gray) rather than four arbitrary hex values, with an
  // explicit `onBadge` label color per bin rather than a single hardcoded
  // white: plain DS --ec-blue (#5489A3) and --ec-orange-dark (#E6883B) both
  // sit at a middling luminance that clears 4.5:1 against neither white nor
  // navy text, so "popular" moved to the darker --ec-blue-mid and
  // "less popular" pairs its orange-dark fill with navy (not white) text —
  // each checked by hand against the WCAG contrast formula. `badge` is also
  // reused as moments-bin-header's border-color, a decorative divider (not
  // text), so it doesn't need its own contrast check the way onBadge does.
  const BIN_STYLE: Record<PopularityBin, { badge: string; onBadge: string }> = {
    "most popular": { badge: "#1C2745", onBadge: "#FFF4EB" }, // navy / cream — 13.6:1
    popular: { badge: "#274D7D", onBadge: "#FFF4EB" }, // blue-mid / cream — 7.9:1
    "less popular": { badge: "#E6883B", onBadge: "#1C2745" }, // orange-dark / navy — 5.6:1
    "least popular": { badge: "#BCBBC1", onBadge: "#1C2745" }, // border-mid / navy — 7.7:1
  };

  // For the sidebar's linkage caveat — the README's data rules require every published
  // number to be defensible, so this is read from rooms.meta rather than
  // hardcoded, and stays accurate as s16-figjam-linkage.ts's matching
  // improves.
  const linkedIdeasCount = $derived(rooms.ideas.filter((i) => i.conceptId !== null).length);
  const linkageCoveragePct = $derived(Math.round(rooms.meta.linkageCoverage * 100));

  // Native `title` tooltip on the info icon next to the heading — same
  // hover-to-reveal convention as .reconcile-flag in
  // DeliberationRoomsByPopularity.svelte/DeliberationRooms.svelte, so this
  // explanatory paragraph doesn't sit permanently in the sidebar's flow.
  const momentsCaveat = $derived(
    `Session highlighting comes from the ${linkedIdeasCount} of ${rooms.ideas.length} ideas (${linkageCoveragePct}%) linked to a concept — some concepts highlight fewer conversations than the workbook's own session count. A conversation gets an outline around the whole group when this concept's idea ranked in the top third by votes among that session's own ideas. Where a concept has a quote from the Engaged California early insights preview, it's shown verbatim with the speaker's own byline; every other concept shows placeholder text, with the byline naming a real attendee of that conversation rather than the person who said it.`,
  );

  // Every session's real attendees, by cluster index — sourced from this
  // layout's own kept dots, so a concept's placeholder-quote byline names a
  // genuine attendee of the conversation that actually raised it.
  const attendeesByCluster = $derived.by(() => {
    const map = new Map<number, MomentAttendee[]>();
    layout.dots.forEach((dot) => {
      if (!dot.kept || dot.group < 0) return;
      const list = map.get(dot.group) ?? [];
      list.push({ region: dot.region, fieldOfWork: dot.fieldOfWork });
      map.set(dot.group, list);
    });
    return map;
  });
  function attendeesFor(session: MomentSession): MomentAttendee[] {
    return attendeesByCluster.get(session.clusterIndex) ?? [];
  }
  // A concept's own numeric suffix ("C-07" -> 7) seeds attributionFor/
  // placeholderQuoteFor so a card's byline+quote never reshuffle on
  // re-render, without threading a separate counter through the template.
  function conceptSeed(conceptId: string): number {
    return parseInt(conceptId.replace(/\D/g, ""), 10) || 0;
  }

  // Stage 4 ("Behind the curtain") data — one placeholder chat per cluster,
  // reusing this same attendeesByCluster lookup (see conversationPeek.ts's
  // header for why this is the other place funnel and rooms data are
  // allowed to meet).
  const conversationPeeks = $derived(buildConversationPeeks(layout.clusters, rooms, (ci) => attendeesByCluster.get(ci) ?? []));

  // Hover previews a conversation; clicking pins it open — same hover-vs-pin
  // split as the Moments concept list below, and DeliberationRoomsByPopularity.svelte's
  // ranked-entry rows.
  let hoveredPeekIndex = $state<number | null>(null);
  let pinnedPeekIndex = $state<number | null>(null);
  const activePeekIndex = $derived(hoveredPeekIndex ?? pinnedPeekIndex);
  const activePeek = $derived<ConversationPeek | null>(activePeekIndex === null ? null : (conversationPeeks[activePeekIndex] ?? null));

  function setPeekHover(index: number) {
    hoveredPeekIndex = index;
  }
  function clearPeekHover() {
    hoveredPeekIndex = null;
  }
  function togglePeekPin(index: number) {
    pinnedPeekIndex = pinnedPeekIndex === index ? null : index;
  }

  // Real DOM heights (not assumed) so the card's panel tracks its own
  // rendered size — a card's turn count/wording can push its height up or
  // down, and this has to stay accurate for both the vertical placement
  // clamp and the leader line's endpoint below.
  let stageHeightPx = $state(0);
  let peekCardHeightPx = $state(0);

  // The card's own top offset and height, both as a fraction of #stage's
  // height — centers the card on the active cluster's y when there's room,
  // clamped so it never runs off the top/bottom of the frame. Falls back to
  // a fixed 0.3 height estimate before the card has rendered once (avoids a
  // div-by-zero flash on the very first hover).
  const peekPanelFrac = $derived.by(() => {
    if (!activePeek || stageHeightPx === 0) return { top: 0.16, height: 0.3 };
    const cluster = layout.clusters[activePeek.clusterIndex];
    if (!cluster) return { top: 0.16, height: 0.3 };
    const height = peekCardHeightPx > 0 ? peekCardHeightPx / stageHeightPx : 0.3;
    const desiredTop = cluster.y / CANVAS.H - height / 2;
    const top = Math.min(Math.max(desiredTop, 0.16), 1 - height - 0.12);
    return { top, height };
  });

  // The leader line's two endpoints, in the same canvas coordinate space the
  // SVG overlay's viewBox uses — the active cluster's own (shifted) edge,
  // and the card's left edge at its own vertical center. Starts at
  // cluster.rc + 8, clear of the OUTLINE ring facilitators() strokes at
  // cl.rc + 4 (1px wide, so its outer edge sits at rc + 4.5) — starting the
  // line at the bare dot radius would draw it straight through that ring.
  const leaderLine = $derived.by(() => {
    if (!activePeek) return null;
    const cluster = layout.clusters[activePeek.clusterIndex];
    if (!cluster) return null;
    const x1 = cluster.x - RING_SHIFT_X + cluster.rc + 8;
    const y1 = cluster.y;
    const x2 = CANVAS.W * 0.67;
    const y2 = (peekPanelFrac.top + peekPanelFrac.height / 2) * CANVAS.H;
    return { d: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${y1} ${x2} ${y2}` };
  });

  // Hover previews a concept's highlight; clicking a concept's <summary>
  // pins it open — same hover-vs-pin split as
  // DeliberationRoomsByPopularity.svelte's ranked-entry rows.
  let hoveredConceptId = $state<string | null>(null);
  let openConceptId = $state<string | null>(null);
  const activeConceptId = $derived(hoveredConceptId ?? openConceptId);
  const activeConcept = $derived<MomentConcept | null>(
    activeConceptId === null ? null : allMomentConcepts.find((c) => c.id === activeConceptId) ?? null,
  );
  const highlightedClusterIndexes = $derived(new Set(activeConcept ? activeConcept.contributing.map((s) => s.clusterIndex) : []));

  // Conversations (clusters) where this concept's idea ranked in the top
  // third by votes among that session's own ideas (topVotedLinkedIdeas,
  // computed in deliberativeMoments.ts from real per-idea vote counts) — the
  // whole conversation gets outlined, not a hand-picked participant, since
  // that's a fact about the session, not about any specific attendee.
  // Always a subset of highlightedClusterIndexes, since every topVotedLinkedIdeas
  // session is also a contributing one.
  const topVotedClusterIndexes = $derived(
    new Set(activeConcept ? activeConcept.contributing.filter((s) => s.topVotedLinkedIdeas > 0).map((s) => s.clusterIndex) : []),
  );

  function setConceptHover(id: string) {
    hoveredConceptId = id;
  }
  function clearConceptHover() {
    hoveredConceptId = null;
  }
  function toggleConceptOpen(id: string) {
    openConceptId = openConceptId === id ? null : id;
  }

  // Which bins are expanded in the sidebar — only the strongest bin starts
  // open (mirrors the reference mockup's own default), the rest collapse
  // behind "See N policy concepts" so 29 rows aren't all on screen at once.
  let openBins = $state<Set<PopularityBin>>(new Set(["most popular"]));
  function toggleBin(key: PopularityBin) {
    const next = new Set(openBins);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openBins = next;
  }

  const DIMENSION_OPTIONS: { key: FunnelDimension; label: string }[] = [
    { key: "region", label: "Region" },
    { key: "fieldOfWork", label: "Field of work" },
  ];
  let dimension = $state<FunnelDimension>("region");

  // Which ambient motion the conversation ring uses at stages 3-5 — a view
  // toggle, not stage data, so it lives beside `dimension` rather than in
  // funnelCloud.ts (see funnelCloud.ts's MotionMode doc comment).
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
  //
  // ACCENT (the active-conversation badge fill/outline, conversationBadges())
  // is --ec-emphasis, NOT the DS orange, even though orange is the brand's
  // usual highlight color: these are non-text graphics, so WCAG 1.4.11 wants
  // 3:1 against the surface behind them, and #E79450 on white is only
  // ~2.4:1. --ec-emphasis resolves to navy on the light surface (14.8:1) and
  // to orange on the dark surface (6.1:1 on navy), where it does clear the
  // bar. The top-voted-conversation ring and its legend swatch used to share
  // ACCENT too, but at 2px navy they read as too heavy for a passive "this
  // one ranked highly" mark — they're OUTLINE (--ec-graphic-hairline) now, a
  // quieter 1px gray in the spirit of the pill buttons' own hairline border,
  // still hand-verified at >=3:1 on every surface this app renders (see that
  // token's own comment in ec-tokens.css).
  //
  // Dot colors are unaffected by any of this — they still come from
  // palette.ts's assignCategoryColors/DATA_VIZ_NEUTRAL_LIGHT (colorFor(),
  // below), which this pass deliberately left untouched (see the
  // component-level plan). Known consequence, not fixed here: on the dark
  // theme's navy surface, DATA_VIZ_NEUTRAL_LIGHT and the
  // DATA_VIZ_CAT_LIGHTER ramp lose contrast — a candidate follow-up for
  // palette.ts itself, once/if this app grows a real dark-mode toggle.
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
  const ACCENT = $derived(ecTokens.emphasis);
  const NEUTRAL = $derived(ecTokens.nondata);
  const OUTLINE = $derived(ecTokens.graphicHairline);
  const DROPPED_COLOR = $derived(ecTokens.dropped);
  const WORD_FONT = "'Noto Sans', Arial, sans-serif";

  const DWELL_MS = 1900;
  const FINAL_DWELL_MS = 6500;
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
    // about that transition. Only ever non-zero entering/leaving stage 2
    // ("Phase 2"), the one stage that draws person glyphs.
    person: number;
    pFrom: number;
  }

  let renders: RenderDot[] = [];
  let clock = 0;
  // One accumulated "active" clock per cluster, indexed like layout.clusters
  // — advances at normal speed while that cluster isn't dimmed (see
  // isClusterDimmed/clockFor below), and eases to a stop, via the same
  // hoverK ramp that already fades a dimmed cluster's alpha, while it is.
  // Feeding orbitPosition this instead of the shared global `clock` is what
  // makes a dimmed conversation's rotation/pulse settle to a genuine pause
  // rather than just look slower — a function of raw elapsed time can't
  // pause without losing its place, but an accumulator that stops
  // incrementing holds exactly where it left off.
  let clusterClock: number[] = [];
  let stage = $state(0);
  // Gates the moments sidebar's fade-in separately from `stage === 5` itself —
  // the ring's dots take up to TRANSITION_MS to slide clear of the sidebar's
  // footprint, so revealing the sidebar the instant stage flips would show it
  // fading in on top of still-migrating dots. Set true once the slide settles.
  let momentsSidebarReady = $state(false);
  // Same gate, for stage 4 ("Behind the curtain")'s conversation hotspots —
  // keeps them out of the tab order and un-clickable until the ring's own
  // leftward slide (shared with stage 5, see RING_SHIFT_X) has settled.
  let curtainReady = $state(false);
  // Same readiness idea as curtainReady/momentsSidebarReady above, but for
  // the ring-center title (see titleK below) — stays false while dots are
  // still migrating into stage 3's ring or sliding into stage 4's shifted
  // position, so the title only fades in once they've actually landed,
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
  // Eased 0-1 amount by which non-contributing dots are currently dimmed —
  // ramps toward 1 whenever a concept is active at stage 4, and back to 0
  // otherwise, over HOVER_EASE_MS. Deliberately its own plain (non-$state)
  // tween, entirely outside the stage-transition machinery above, since
  // hovering a concept has nothing to do with which stage is playing.
  let hoverK = 0;
  const HOVER_EASE_MS = 180;
  // Eased 0-1 visibility of the ring-center headcount title — ramps to 1
  // across stages 3-4 ("Conversations"/"Behind the curtain") and back to 0
  // everywhere else, so it fades in/out instead of popping with the stage
  // switch. Slower than HOVER_EASE_MS since it's tracking a stage change
  // (TRANSITION_MS-scale), not a quick hover response.
  let titleK = 0;
  const TITLE_EASE_MS = 900;

  // Built once, not per frame — Path2D is immutable and every dot/facilitator
  // stamp reuses this same instance under its own ctx.translate/scale.
  const PERSON = new Path2D(PERSON_PATH);

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  // Read imperatively by onWindowClick's containment check, below — not
  // reactive state, same convention as `canvas` itself.
  let peekPanelEl: HTMLDivElement | null = null;

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
  // height (PERSON_BOX.h) becomes `height` canvas px. Used by the stage-2
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

  // funnelCloud.ts's dotTarget() now uses an 8-stage numbering (0-7),
  // renumbered for a later feature (the "cloud + concepts" sibling
  // prototype) that inserted a new stage after Phase 1. This plain
  // prototype still uses the original 6-stage numbering (0-5) internally —
  // this shim translates this component's own stage number to the shared
  // library's current numbering at the one boundary where they meet,
  // rather than renumbering this file's stage variable to match.
  function libStage(s: number): number {
    return s === 0 ? 0 : s + 1;
  }

  function resetRenders() {
    renders = layout.dots.map((dot) => {
      const g = dotTarget(dot, libStage(stage), dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
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

  function goTo(nextStage: number) {
    if (nextStage === stage && t >= 1) return;
    prevStage = stage;
    stage = nextStage;
    // Stage 5 holds indefinitely (see dwellFor) regardless of Loop, but
    // switch the toggle itself off on arrival so its pressed state doesn't
    // keep promising a loop that dwellFor's Infinity will never trigger.
    if (nextStage === 5) looping = false;
    t = reduced ? 1 : 0;
    curtainReady = nextStage === 4 && reduced;
    momentsSidebarReady = nextStage === 5 && reduced;
    ringReady = (nextStage === 3 || nextStage === 4) && reduced;
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
      const g = dotTarget(dot, libStage(stage), dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
      const r = renders[i];
      r.pos = [g.x, g.y];
      r.alpha = g.alpha;
      r.r = g.r;
      r.cNow = colorFor(g.categoryKey);
      r.person = g.person ? 1 : 0;
    });
  }

  // Stage 5 ("Deliberative moments") holds forever once reached — clock and
  // orbit keep running (dwellLeft just never reaches 0), but auto-advance
  // and looping both stop there so a hovered/open concept is never yanked
  // away mid-read. Stages 3 and 4 each keep their own long dwell before
  // sliding on — stage 4's so a hovered/pinned conversation isn't yanked
  // away either (frame()'s dwellLeft pause below covers the rest of that).
  const dwellFor = (s: number) => (s === 5 ? Infinity : s === 3 || s === 4 ? FINAL_DWELL_MS : DWELL_MS);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const COPY = $derived([
    { eyebrow: "Stage 1", title: "Phase 1", sub: "Everyone who took part in the opening round.", count: layout.phase1Total, unit: "participants" },
    { eyebrow: "Stage 2", title: "Moving forward", sub: "A smaller group continues into the next round.", count: layout.keptTotal, unit: "continue to phase 2" },
    { eyebrow: "Stage 3", title: "Phase 2", sub: "The full phase 2 cohort, gathered.", count: layout.keptTotal, unit: "participants" },
    {
      eyebrow: "Stage 4",
      title: "The conversations",
      sub: "Small groups of uneven size, each around a facilitator.",
      count: layout.clusters.length,
      unit: "conversations",
    },
    {
      eyebrow: "Stage 5",
      title: "The power of the discussion",
      sub: "Peek behind the curtain of one conversation.",
      count: layout.clusters.length,
      unit: "conversations to open",
    },
    {
      eyebrow: "Stage 6",
      title: "Policy concepts we heard",
      sub: "What each conversation pushed for, ranked by how widely it spread.",
      count: allMomentConcepts.length,
      unit: "policy concepts",
    },
  ]);

  // Where header()'s big trailing number right-aligns to — fixed at the
  // canvas's right edge for every stage, including 4. What actually keeps
  // it clear of the moments sidebar isn't horizontal (the sidebar sits at
  // the far right regardless): the count and unit baselines are y=84/108,
  // and the sidebar's `top: 19%` of CANVAS.H puts its own top edge at
  // y~154 — well below both, so the two never share a row.
  const NUMBER_X = 980;

  function header() {
    if (!ctx) return;
    const from = COPY[prevStage];
    const to = COPY[stage];
    const k = easeInOut(Math.min(1, t * 1.6));

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.globalAlpha = 1;
    ctx.font = `700 12px ${WORD_FONT}`;
    ctx.fillStyle = GRAY;
    ctx.letterSpacing = "0.08em"; // sentence case ("Stage 1"), not the old space-joined ALL CAPS — DS: no ALL CAPS in UI copy
    ctx.fillText(k < 0.5 ? from.eyebrow : to.eyebrow, 60, 46);
    ctx.letterSpacing = "0px";

    ctx.globalAlpha = Math.abs(k - 0.5) * 2;
    ctx.font = `900 30px ${WORD_FONT}`; // DS H2 (30px) at Black weight, matching the hero/H1 tracking below
    ctx.letterSpacing = "-0.02em";
    ctx.fillStyle = INK;
    ctx.fillText(k < 0.5 ? from.title : to.title, 60, 82);
    ctx.letterSpacing = "0px";
    ctx.font = `400 16px ${WORD_FONT}`; // DS --ec-text-body-sm
    ctx.fillStyle = GRAY;
    ctx.fillText(k < 0.5 ? from.sub : to.sub, 60, 106);
    ctx.globalAlpha = 1;

    const val = Math.round(lerp(from.count, to.count, easeInOut(t)));
    ctx.textAlign = "right";
    ctx.font = `900 47px ${WORD_FONT}`; // DS --ec-text-hero, Black weight
    ctx.letterSpacing = "-0.02em";
    ctx.fillStyle = INK;
    ctx.fillText(fmt(val), NUMBER_X, 84);
    ctx.letterSpacing = "0px";

    ctx.globalAlpha = Math.abs(k - 0.5) * 2;
    ctx.font = `400 14px ${WORD_FONT}`; // DS --ec-text-caption
    ctx.fillStyle = GRAY;
    // Right-aligned to the same fixed NUMBER_X as the count above, so the
    // two never share a column with the left-aligned sub-line regardless
    // of either string's length. Same 24px title->sub gap (82 -> 106) as
    // the left column, applied to this column's count->unit baselines
    // (84 -> 108), so both stacked pairs read with matching rhythm.
    ctx.fillText(k < 0.5 ? from.unit : to.unit, NUMBER_X, 108);
    ctx.globalAlpha = 1;
  }

  // A cluster's own (x, y) is the canonical, unshifted position used by
  // orbitPosition() — dotTarget applies the stage-4/5 leftward shift only to
  // individual dots' render targets (see funnelCloud.ts). Anything else
  // drawn at a cluster's center (facilitator marker, badges, moment rings)
  // has to apply that same shift itself at stages 4-5, or it'll draw over
  // the pre-shift position while the dots orbiting it have already moved.
  function clusterCenter(cluster: Cluster): [number, number] {
    return stage === 4 || stage === 5 ? [cluster.x - RING_SHIFT_X, cluster.y] : [cluster.x, cluster.y];
  }

  // Whether a cluster's ring should read as dimmed right now — true when a
  // concept (stage 5) or peek (stage 4) is active and this cluster isn't
  // part of what's highlighted. Shared by facilitators() (ring/legend
  // dimming) and frame() (the per-cluster activity clock below), so a
  // cluster can never read as dimmed in one place and highlighted in
  // another.
  function isClusterDimmed(clusterIndex: number): boolean {
    const conceptHighlightActive = stage === 5 && activeConceptId !== null;
    const peekHighlightActive = stage === 4 && activePeekIndex !== null;
    return (conceptHighlightActive && !highlightedClusterIndexes.has(clusterIndex)) || (peekHighlightActive && clusterIndex !== activePeekIndex);
  }

  // Which clock a dot's orbit/pulse position should read: its own cluster's
  // activity clock at the stages that actually orbit (3-5), so a dimmed
  // conversation's motion can pause independently of every other cluster;
  // the shared global `clock` everywhere else (cloud drift, gather, etc.),
  // where there's no per-cluster concept to pause.
  function clockFor(dot: FunnelDot): number {
    if ((stage === 3 || stage === 4 || stage === 5) && dot.group >= 0) return clusterClock[dot.group] ?? clock;
    return clock;
  }

  function facilitators() {
    if (!ctx) return;
    const vis = stage === 3 || stage === 4 || stage === 5 ? easeInOut(Math.max(0, (t - 0.45) / 0.55)) : 0;
    if (vis <= 0.01) return;

    // Two independent reasons a cluster can be dimmed/outlined: stage 5's
    // hovered/pinned policy concept (a set of contributing conversations),
    // or stage 4's hovered/pinned single conversation (exactly one cluster).
    // The two stages never overlap, so a cluster is never targeted by both.
    const conceptHighlightActive = stage === 5 && activeConceptId !== null;
    const peekHighlightActive = stage === 4 && activePeekIndex !== null;
    layout.clusters.forEach((cl, clusterIndex) => {
      const dimmed = isClusterDimmed(clusterIndex);
      const mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      ctx!.globalAlpha = vis * mult;
      const [cx, cy] = clusterCenter(cl);

      // The whole conversation, not a hand-picked participant, gets outlined
      // when its idea ranked in the top third by votes among that session's
      // own ideas (topVotedClusterIndexes) — a fact about the session, so
      // the mark surrounds the group rather than singling out an attendee.
      // topVotedClusterIndexes is always a subset of highlightedClusterIndexes
      // (see its own definition), so `dimmed` is never true here — no need
      // to re-check it. Stage 4's active conversation gets the identical
      // treatment for the same reason: it's the one real fact about that
      // cluster this stage is highlighting. Drawn before the facilitator
      // glyph so that glyph stays on top.
      if ((conceptHighlightActive && topVotedClusterIndexes.has(clusterIndex)) || (peekHighlightActive && clusterIndex === activePeekIndex)) {
        // In pulse mode, breathes on the exact same cluster clock/phase/
        // period as this cluster's own dots (clusterClock[clusterIndex], via
        // clockFor above) — a highlighted cluster is never dimmed (see this
        // block's own comment above), so that clock always runs at full
        // speed here, keeping the ring's breath in lockstep with the dots
        // inside it rather than drifting out of sync.
        const outlineR = motion === "pulse" ? (cl.rc + 4) * (1 + PULSE_AMPLITUDE * Math.sin(((clusterClock[clusterIndex] ?? 0) / cl.pulsePeriod) * Math.PI * 2 + cl.pulsePhase)) : cl.rc + 4;
        ctx!.globalAlpha = vis * hoverK;
        ctx!.beginPath();
        ctx!.arc(cx, cy, outlineR, 0, Math.PI * 2);
        ctx!.strokeStyle = OUTLINE;
        ctx!.lineWidth = 1;
        ctx!.stroke();
        ctx!.globalAlpha = vis;
      }

      // Every stage facilitators() draws on (3, 4, 5) shows plain dots, not
      // person glyphs (see dotTarget's `person` doc comment) — so the
      // facilitator mark is always this three-arc donut now, never the
      // person-glyph crossfade it used to have alongside the retired People
      // toggle (see git history if reviving that).
      ctx!.globalAlpha = vis * mult;
      ctx!.beginPath();
      ctx!.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx!.fillStyle = SURFACE;
      ctx!.fill();
      ctx!.beginPath();
      ctx!.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx!.fillStyle = NEUTRAL;
      ctx!.fill();
      ctx!.beginPath();
      ctx!.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx!.fillStyle = SURFACE;
      ctx!.fill();
    });
    ctx.lineWidth = 1;

    ctx.globalAlpha = vis;
    // Sits above the outlined-dot row below it at CANVAS.H - 84, and both
    // sit above categoryLegend()'s own rows starting at CANVAS.H - 58 — a
    // 24px rhythm throughout (matching categoryLegend()'s row pitch, bumped
    // up from 21/22px along with the DS's larger 14px minimum type). The
    // ring's lowest point never reaches within ~50px of even the topmost of
    // these three rows, so there's no risk of overlap.
    const lx = 60,
      ly = CANVAS.H - 108;
    // Matches facilitators()'s own ring mark, above — a plain dot and a
    // donut, since every stage this legend appears on (3, 4, 5) draws plain
    // dots, not person glyphs (see dotTarget's `person` doc comment).
    {
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
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `400 14px ${WORD_FONT}`; // DS --ec-text-caption
    ctx.fillStyle = GRAY;
    ctx.fillText("Participant", lx + 12, ly);
    ctx.fillText("Facilitator", lx + 120, ly);

    // A third row, not a continuation of the row above — starting fresh at
    // lx keeps it clear of .dimension-toggle (centered on #stage, so its
    // left edge sits well right of this row's short text) regardless of the
    // fact that this row's y falls in the same band the toggle occupies.
    // Only drawn while a concept or conversation is actually highlighted,
    // since the outline it explains doesn't exist otherwise; fades with the
    // same hoverK as that stroke. Glyph is a small cluster (dot + accent
    // ring around it) rather than a single outlined dot, to match the
    // actual mark: the whole conversation, not one attendee. The caption
    // itself differs by stage — stage 5's outline means "ranked top-voted",
    // stage 4's means "the one you're looking at" — since neither claim
    // holds for the other stage's reason for outlining.
    if (conceptHighlightActive || peekHighlightActive) {
      const ly2 = CANVAS.H - 84;
      ctx.globalAlpha = vis * hoverK;
      ctx.beginPath();
      ctx.arc(lx, ly2, 4, 0, Math.PI * 2);
      ctx.fillStyle = GRAY;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly2, 8, 0, Math.PI * 2);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = GRAY;
      ctx.fillText(peekHighlightActive ? "Outlined: the open conversation" : "Outlined: a top-voted conversation", lx + 14, ly2);
    }

    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  // The hovered/open concept's name, dropped into the ring's own empty
  // center — the ring already leaves that space free (same center point
  // clusterCenter() shifts every other stage-5 draw call to), so this is
  // real, otherwise-unused room rather than a new overlay competing with
  // the sidebar. Fades in with the same hoverK as the dot dimming/outline, and
  // only once the stage-5 arrival has settled (t >= 1) so it never floats
  // independently mid-slide.
  function momentCenterLabel() {
    if (!ctx || stage !== 5 || t < 1 || !activeConcept || hoverK <= 0.01) return;
    const cx = CX - RING_SHIFT_X;
    const cy = CY;
    const maxClusterRc = Math.max(...layout.clusters.map((c) => c.rc), 0);
    const freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    const CHAR_WIDTH_PX = 8.9; // ~16px bold Noto Sans estimate, no DOM measurement available here
    const lines = wrapLabel(displayNameFor(activeConcept, insightOf(activeConcept.id)), freeRadius * 1.7, CHAR_WIDTH_PX).slice(0, 3);
    const lineHeight = 22;

    ctx.globalAlpha = hoverK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 16px ${WORD_FONT}`;
    ctx.fillStyle = INK;
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, li) => ctx!.fillText(line, cx, startY + li * lineHeight));

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // The ring-center headcount ("N people in M conversations") fades in (via
  // titleK) across stage 3 ("Conversations") and stays through stage 4
  // ("Behind the curtain"), where it picks up a second, lighter-weight
  // invitation line to open a conversation — which fades out once one is
  // hovered/pinned (the count line stays, so the ring doesn't lose its one
  // piece of always-on context) — then fades back out as stage 5 begins,
  // rather than cutting off with the stage switch the way a plain `stage ===`
  // guard would. cx mirrors clusterCenter's own RING_SHIFT_X logic so the
  // label tracks the ring through the shift and the stage 4→5 hold. Same
  // wrapLabel/freeRadius recipe as momentCenterLabel above.
  function curtainCenterLabel() {
    if (!ctx || titleK <= 0.01) return;
    const cx = stage === 4 || stage === 5 ? CX - RING_SHIFT_X : CX;
    const cy = CY;
    const maxClusterRc = Math.max(...layout.clusters.map((c) => c.rc), 0);
    const freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    const maxWidth = freeRadius * 1.7;
    const lineHeight = 22;
    const gap = 6;

    // Keeps showing (fading with titleK, same as the count line) through the
    // stage 4→5 hand-off, not just while stage === 4 outright — otherwise it
    // would vanish on the exact frame stage flips to 5, one beat ahead of the
    // count line's own titleK fade, and that one-line-lingers/one-line-gone
    // mismatch is what reads as an abrupt cut even though the count line
    // itself is fading smoothly.
    const showPrompt = stage === 4 || (stage === 5 && titleK > 0.01);
    const countLines = wrapLabel(`${fmt(layout.keptTotal)} people in ${fmt(layout.clusters.length)} conversations`, maxWidth, 8.9).slice(0, 2);
    const promptLines = showPrompt ? wrapLabel("Open one to see how a conversation unfolded", maxWidth, 7.8).slice(0, 2) : [];
    const totalHeight = countLines.length * lineHeight + (promptLines.length ? gap + promptLines.length * lineHeight : 0);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let y = cy - totalHeight / 2 + lineHeight / 2;

    ctx.globalAlpha = titleK;
    ctx.font = `700 16px ${WORD_FONT}`;
    ctx.fillStyle = INK;
    countLines.forEach((line) => {
      ctx!.fillText(line, cx, y);
      y += lineHeight;
    });

    if (promptLines.length) {
      y += gap;
      ctx.font = `400 14px ${WORD_FONT}`;
      ctx.fillStyle = GRAY;
      ctx.globalAlpha = titleK * (1 - hoverK);
      promptLines.forEach((line) => {
        ctx!.fillText(line, cx, y);
        y += lineHeight;
      });
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // A hairline session-number badge on every conversation, stage 4 only —
  // makes the ring self-labelling (the card's own "Conversation N" header is
  // otherwise unfindable on the ring) and gives every cluster a visible
  // affordance that it's the thing the 14 DOM hotspots (see the template)
  // sit on top of. The active one fills solid to match the card it's
  // pointing at.
  function conversationBadges() {
    if (!ctx || stage !== 4) return;
    const vis = easeInOut(Math.max(0, (t - 0.45) / 0.55));
    if (vis <= 0.01) return;

    layout.clusters.forEach((cl, clusterIndex) => {
      const peek = conversationPeeks[clusterIndex];
      const isActive = activePeekIndex === clusterIndex;
      const [ccx, ccy] = clusterCenter(cl);
      // Up-and-right onto the ring's own outer edge, clear of the
      // facilitator glyph facilitators() draws at the cluster's own center.
      const bx = ccx + Math.cos(-Math.PI / 4) * (cl.rc + 10);
      const by = ccy + Math.sin(-Math.PI / 4) * (cl.rc + 10);

      ctx!.globalAlpha = vis;
      ctx!.beginPath();
      ctx!.arc(bx, by, 10, 0, Math.PI * 2);
      ctx!.fillStyle = isActive ? ACCENT : SURFACE;
      ctx!.fill();
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = isActive ? ACCENT : ecTokens.hairline;
      ctx!.stroke();

      ctx!.fillStyle = isActive ? SURFACE : GRAY;
      ctx!.font = `700 11px ${WORD_FONT}`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.fillText(String(peek?.sessionNumber ?? clusterIndex + 1), bx, by);
    });

    ctx!.globalAlpha = 1;
    ctx!.lineWidth = 1;
    ctx!.textAlign = "left";
    ctx!.textBaseline = "alphabetic";
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

    let y = CANVAS.H - 58;
    for (const row of rows) {
      let x = (CANVAS.W - (row.reduce((a, i) => a + w[i], 0) - PAD)) / 2;
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
    ctx.clearRect(0, 0, CANVAS.W, CANVAS.H);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, CANVAS.W, CANVAS.H);

    header();

    for (let i = 0; i < layout.dots.length; i++) {
      const r = renders[i];
      if (!r || r.alpha <= 0.008) continue;
      // Render-time-only dimming: never written back into r.alpha, since
      // that value is what every future transition's `aFrom` interpolates
      // from — baking the dim in would leave a hovered-away concept's dots
      // permanently darker after the next stage change.
      const dot = layout.dots[i];
      const conceptActive = stage === 5 && activeConceptId !== null && dot.kept;
      const peekActive = stage === 4 && activePeekIndex !== null && dot.kept;
      const dimmed = (conceptActive && !highlightedClusterIndexes.has(dot.group)) || (peekActive && dot.group !== activePeekIndex);
      const mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      const fill = css(r.cNow);
      ctx.fillStyle = fill;

      // p is this dot's own morph amount, staggered per-dot by the stage
      // transition (see `person`/`pFrom` on RenderDot). Crossfading the two
      // marks by alpha, while the glyph's own height also lerps from the
      // dot's diameter up to its full person height, is what makes a dot
      // look like it's growing into a figure rather than one hard-swapping
      // for the other — used only entering/leaving stage 2 ("Phase 2"),
      // the one stage that draws person glyphs.
      const p = r.person;
      if (p < 0.999) {
        ctx.globalAlpha = r.alpha * mult * (1 - p);
        ctx.beginPath();
        ctx.arc(r.pos[0], r.pos[1], r.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p > 0.001) {
        ctx.globalAlpha = r.alpha * mult * p;
        stampPerson(r.pos[0], r.pos[1], lerp(2 * r.r, personHeightFor(r.r), p));
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    facilitators();
    conversationBadges();
    curtainCenterLabel();
    momentCenterLabel();
    categoryLegend();
  }

  function frame(now: number) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    const hoverTarget = (stage === 5 && activeConceptId !== null) || (stage === 4 && activePeekIndex !== null) ? 1 : 0;
    hoverK += (hoverTarget - hoverK) * Math.min(1, dt / HOVER_EASE_MS);

    // Fades in gradually once the ring settles. Fading out is split two
    // ways: leaving the stage 3/4 family entirely (to stage 5, or back past
    // stage 3) eases out over TITLE_EASE_MS, same as the fade-in. But
    // resettling *within* that family — the 3<->4 slide — drops ringReady
    // false for the whole slide, and an eased fade-out there would stay
    // partly visible hovering on top of dots that are still mid-flight, so
    // that specific case snaps off instantly instead.
    const titleTarget = (stage === 3 || stage === 4) && ringReady ? 1 : 0;
    if (titleTarget === 0 && (stage === 3 || stage === 4)) titleK = 0;
    else titleK += (titleTarget - titleK) * Math.min(1, dt / TITLE_EASE_MS);

    if (playing) {
      clock += dt / 1000;
      // Each cluster's own activity clock advances at full speed unless
      // dimmed, in which case it eases toward a stop on the same hoverK ramp
      // that fades the cluster's alpha — see clusterClock's own declaration
      // and isClusterDimmed/clockFor above.
      layout.clusters.forEach((_, i) => {
        const activity = isClusterDimmed(i) ? lerp(1, 0, hoverK) : 1;
        clusterClock[i] = (clusterClock[i] ?? 0) + (dt / 1000) * activity;
      });

      if (t < 1) {
        t = Math.min(1, t + dt / TRANSITION_MS);
        const span = 0.7;
        layout.dots.forEach((dot, i) => {
          const g = dotTarget(dot, libStage(stage), dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
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
          if (stage === 4) curtainReady = true;
          if (stage === 5) momentsSidebarReady = true;
          if (stage === 3 || stage === 4) ringReady = true;
        }
      } else {
        // Stage 4's dwell pauses entirely while a conversation is
        // hovered/pinned, same reasoning as stage 5's Infinity hold — a
        // conversation being read is never yanked away by autoplay.
        if (!(stage === 4 && activePeekIndex !== null)) dwellLeft -= dt;
        if (dwellLeft <= 0) {
          if (stage < 5) goTo(stage + 1);
          else if (looping) goTo(0);
          else playing = false;
        }
      }
    }

    // stage 2 has no continuous drift/orbit of its own (the gathered phase-2
    // cohort just sits still), but it still needs this loop to run — this is
    // the only thing that re-reads `dimension` while idle (see the cNow
    // comment below), and skipping stage 2 left it stuck on whichever color
    // was current the last time a real stage transition passed through it.
    // Every valid stage (0-5) needs it, so the condition just checks `t`.
    if (t >= 1) {
      layout.dots.forEach((dot, i) => {
        if ((stage === 3 || stage === 4 || stage === 5) && !dot.kept) return;
        const g = dotTarget(dot, libStage(stage), dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
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
    clusterClock = layout.clusters.map(() => 0);
    stage = 0;
    prevStage = 0;
    t = 1;
    curtainReady = false;
    momentsSidebarReady = false;
    ringReady = false;
    hoveredPeekIndex = null;
    pinnedPeekIndex = null;
    resetRenders();
    dwellLeft = DWELL_MS;
    playing = true;
  }

  function togglePlay() {
    playing = !playing;
    if (playing && t >= 1 && stage === 5 && !looping) restart();
  }

  function jumpTo(s: number) {
    goTo(s);
    dwellLeft = dwellFor(stage);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight" && stage < 5) {
      jumpTo(stage + 1);
    } else if (e.key === "ArrowLeft" && stage > 0) {
      jumpTo(stage - 1);
    } else if (e.key === "Escape" && (openConceptId !== null || pinnedPeekIndex !== null)) {
      openConceptId = null;
      pinnedPeekIndex = null;
    }
  }

  // Closes a pinned conversation on a click anywhere outside its own card —
  // checked via DOM containment (not a click handler on the card itself,
  // which would need its own keyboard handler/ARIA role to satisfy a11y
  // lint for a non-interactive wrapper) so clicking inside the card to read
  // it never closes it. A hotspot's own click stops propagation before this
  // ever runs, so re-pinning the same conversation never immediately
  // unpins it.
  function onWindowClick(e: MouseEvent) {
    if (stage !== 4 || pinnedPeekIndex === null) return;
    if (peekPanelEl?.contains(e.target as Node)) return;
    pinnedPeekIndex = null;
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
  }

  // Runs once, whenever `layout` itself changes (only happens once, when
  // `data` first resolves) — never again after that, since `data` is never
  // reassigned. restart() incidentally reads `stage`/`dimension` (through
  // resetRenders -> dotTarget) to seed initial render state; without
  // untrack(), that read would make THIS effect depend on `stage` too, so
  // every later `goTo()` inside the animation loop (a plain state write,
  // not related to `layout` at all) would re-fire this effect and snap the
  // whole animation back to stage 0 — exactly the "never advances past
  // Phase 1" bug this comment is here to prevent regressing.
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

<svelte:window onkeydown={onKeydown} onclick={onWindowClick} />

<div class="funnel-cloud">
  <div id="stage" bind:clientHeight={stageHeightPx}>
    <canvas
      bind:this={canvas}
      width={CANVAS.W}
      height={CANVAS.H}
      aria-label={`Animation showing ${fmt(layout.phase1Total)} phase one participants funnelling down to ${layout.keptTotal}, who then separate into ${layout.clusters.length} conversation groups arranged in a ring, colored by ${dimension === "region" ? "region" : "field of work"}. The phase 2 cohort is shown as a person figure, one per attendee, only as it gathers; the conversation stages that follow show each attendee as a plain dot, ${motion === "orbit" ? "rotating steadily around its conversation's center" : "slowly rotating while drifting closer to and farther from its conversation's center, breathing in and out"}. A later stage lets you open any one conversation to see a placeholder chat from that room. A final stage lists the ${allMomentConcepts.length} policy concepts those conversations raised.`}
    ></canvas>
    <div class="dimension-toggle">
      {#each DIMENSION_OPTIONS as opt}
        <EcButton variant="pill" pressed={dimension === opt.key} onclick={() => (dimension = opt.key)}>
          {opt.label}
        </EcButton>
      {/each}
    </div>

    {#if stage === 4 && leaderLine}
      <svg class="peek-leader" viewBox="0 0 {CANVAS.W} {CANVAS.H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path d={leaderLine.d} fill="none" stroke={OUTLINE} stroke-width="1.5" />
      </svg>
    {/if}

    {#each layout.clusters as cluster, ci (ci)}
      {@const peek = conversationPeeks[ci]}
      <button
        type="button"
        class="peek-hotspot"
        style="left: {((cluster.x - RING_SHIFT_X) / CANVAS.W) * 100}%; top: {(cluster.y / CANVAS.H) *
          100}%; width: {((2 * cluster.rc) / CANVAS.W) * 100}%; height: {((2 * cluster.rc) / CANVAS.H) * 100}%"
        aria-label={`Conversation ${peek?.sessionNumber ?? ci + 1}, ${peek?.attendeeCount ?? 0} people, ${peek?.dateLabel ?? ""}`}
        aria-pressed={pinnedPeekIndex === ci}
        inert={!(stage === 4 && curtainReady)}
        tabindex={stage === 4 && curtainReady ? 0 : -1}
        onpointerenter={() => setPeekHover(ci)}
        onpointerleave={clearPeekHover}
        onfocus={() => setPeekHover(ci)}
        onblur={clearPeekHover}
        onclick={(e) => {
          e.stopPropagation();
          togglePeekPin(ci);
        }}
      ></button>
    {/each}

    <div
      class="peek-panel"
      class:visible={stage === 4 && activePeek !== null}
      inert={!(stage === 4 && activePeek !== null)}
      style="top: {peekPanelFrac.top * 100}%"
      bind:this={peekPanelEl}
    >
      {#if activePeek}
        <div bind:clientHeight={peekCardHeightPx}>
          <ConversationPeekCard
            peek={activePeek}
            {colorOf}
            {dimension}
            pinned={pinnedPeekIndex === activePeek.clusterIndex}
            ontoggle={() => togglePeekPin(activePeek.clusterIndex)}
          />
        </div>
      {/if}
    </div>

    <div class="moments-sidebar" class:visible={momentsSidebarReady} inert={!momentsSidebarReady}>
      <EcCard padding="20px">
        <div class="moments-heading">
          <h3>100+ Californians across 14 live sessions</h3>
          <span class="info-wrap">
            <button type="button" class="info-icon" aria-describedby="moments-info-tooltip">i</button>
            <span class="info-tooltip" id="moments-info-tooltip" role="tooltip">{momentsCaveat}</span>
          </span>
        </div>
        <p class="moments-intro">Hover a concept to see which conversations raised it; click to keep it open.</p>
        <div class="moments-scroll">
          {#each momentGroups as group, gi (group.key)}
            {#if group.concepts.length > 0}
              {@const isOpen = openBins.has(group.key)}
              <div class="moments-bin">
                <div class="moments-bin-header" style="border-color: {BIN_STYLE[group.key].badge}">
                  <span class="bin-badge" style="background: {BIN_STYLE[group.key].badge}; color: {BIN_STYLE[group.key].onBadge}">{gi + 1}</span>
                  <span class="bin-title">{group.label}</span>
                </div>
                <p class="bin-meta">
                  {group.concepts.length} policy concept{group.concepts.length === 1 ? "" : "s"} · composite {group.range}
                </p>
                <EcButton variant="pill" aria-expanded={isOpen} onclick={() => toggleBin(group.key)}>
                  {isOpen ? "Hide" : "See"} {group.concepts.length} policy concept{group.concepts.length === 1 ? "" : "s"}
                  <EcGlyph kind={isOpen ? "chevron-up" : "chevron-down"} size={18} />
                </EcButton>
                {#if isOpen}
                  <ul class="moments-list">
                    {#each group.concepts as concept (concept.id)}
                      {@const seed = conceptSeed(concept.id)}
                      {@const isConceptOpen = openConceptId === concept.id}
                      {@const insight = insightOf(concept.id)}
                      {@const quotes = cardQuotesFor(concept, insight, attendeesFor, seed)}
                      <li>
                        <details open={isConceptOpen}>
                          <summary
                            onpointerenter={() => setConceptHover(concept.id)}
                            onpointerleave={clearConceptHover}
                            onfocus={() => setConceptHover(concept.id)}
                            onblur={clearConceptHover}
                            onclick={(e) => {
                              e.preventDefault();
                              toggleConceptOpen(concept.id);
                            }}
                          >
                            <span class="concept-name">{displayNameFor(concept, insight)}</span>
                            <EcGlyph kind={isConceptOpen ? "minus" : "plus"} size={18} />
                          </summary>
                          <div class="concept-quotes">
                            {#if quotes.length === 0}
                              <p class="concept-empty">No linked conversations to highlight yet.</p>
                            {:else}
                              {#each quotes as quote, qi (qi)}
                                <blockquote>
                                  <p class="quote-text">
                                    “{quote.text}”
                                    {#if quote.isPlaceholder}<EcStatusPill tone="var(--ec-on-surface-muted)">Placeholder text</EcStatusPill>{/if}
                                  </p>
                                  <p class="quote-byline">— {quote.byline}</p>
                                </blockquote>
                              {/each}
                            {/if}
                          </div>
                        </details>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </EcCard>
    </div>
  </div>

  <div class="controls">
    <EcButton variant="primary" onclick={togglePlay}>{playing ? "Pause" : "Play"}</EcButton>
    <EcButton variant="outline" onclick={restart}>Restart</EcButton>
    <div class="spacer"></div>
    <EcButton variant="pill" pressed={stage === 0} onclick={() => jumpTo(0)}>1 · Phase 1</EcButton>
    <EcButton variant="pill" pressed={stage === 1} onclick={() => jumpTo(1)}>2 · Selected</EcButton>
    <EcButton variant="pill" pressed={stage === 2} onclick={() => jumpTo(2)}>3 · Phase 2</EcButton>
    <EcButton variant="pill" pressed={stage === 3} onclick={() => jumpTo(3)}>4 · Conversations</EcButton>
    <EcButton variant="pill" pressed={stage === 4} onclick={() => jumpTo(4)}>5 · Behind the curtain</EcButton>
    <EcButton variant="pill" pressed={stage === 5} onclick={() => jumpTo(5)}>6 · Moments</EcButton>
    <EcButton variant="pill" pressed={looping} onclick={() => (looping = !looping)}>Loop</EcButton>
    {#each MOTION_OPTIONS as opt}
      <EcButton variant="pill" pressed={motion === opt.key} onclick={() => (motion = opt.key)}>{opt.label}</EcButton>
    {/each}
  </div>

  <p class="hint">
    Toggle between Region and Field of work to recolor the same {layout.keptTotal} real phase 2 attendees by a
    different demographic — the set of people highlighted never changes, only what distinguishes them. {data.meta
      .sampleCaveat} {rooms.meta.sampleCaveat}
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

  /* Sits just above categoryLegend()'s canvas-drawn rows (starting at
     CANVAS.H - 58) — bottom is a percentage, not a pixel offset, so it
     stays pinned there as the canvas scales with its container. Nudged
     from the pre-EC 9% to clear the legend's own taller (14px) rows. */
  .dimension-toggle {
    position: absolute;
    left: 50%;
    bottom: 10%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
  }

  /* One invisible round button per cluster, sized/positioned as a percentage
     of #stage in both axes independently (not a single percentage plus
     aspect-ratio math) — #stage and the canvas share one aspect ratio, so a
     circle sized this way renders as a true circle regardless of viewport
     width. Always mounted; `inert` (set from curtainReady, not stage alone,
     so it doesn't grab focus mid-slide) keeps it out of the tab order and
     un-clickable outside stage 4. Positions use each cluster's own
     unshifted (x, y) minus RING_SHIFT_X directly, rather than
     clusterCenter() (a component function, not available to a style
     expression) — the two stay in sync only because both read the same
     RING_SHIFT_X constant. */
  .peek-hotspot {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  /* Fills #stage so its viewBox can share canvas coordinates 1:1 (see
     ParticipantFunnelCloud.svelte's leaderLine comment) — stroke is drawn in
     the same OUTLINE gray as the ring's own highlight outline, at stage 4
     only, so it reads as an extension of that ring rather than a second,
     competing dark line, and never competes with the categoryLegend() rows
     drawn beneath it (this sits above the canvas in DOM order). */
  .peek-leader {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* The stage-4 ("Behind the curtain") conversation-peek card's own column —
     same right-hand footprint .moments-sidebar occupies at stage 5 (in lieu
     of it, per the design brief), but height-auto and vertically tracking
     the active conversation (see peekPanelFrac) rather than a fixed
     top/bottom box, since a tooltip pointing at something reads differently
     from a persistent sidebar. Always mounted for the same reason
     .moments-sidebar is: `inert` needs a stable element to toggle, with no
     mount/unmount flash mid-fade. */
  .peek-panel {
    position: absolute;
    right: 0;
    width: 33%;
    opacity: 0;
    pointer-events: none;
    transition: opacity 300ms ease;
  }

  .peek-panel.visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* Overlays the space the ring vacates when it slides left for stage 6 —
     percentage offsets of #stage (same technique as .dimension-toggle
     above) so it tracks the canvas as it scales, rather than a fixed pixel
     box. Always mounted (so `inert` reliably removes it from the tab order
     the instant stage !== 5, with no mount/unmount flash); opacity is the
     only thing that fades. Widened from the pre-EC 29% to fit the DS's
     14px+ type scale — funnelCloud.ts's RING_SHIFT_X was widened to
     match, see that constant's own comment for the clearance math. */
  .moments-sidebar {
    position: absolute;
    right: 0;
    /* top pushed well below header()'s canvas-drawn sub-line (baseline
       y=106 of CANVAS.H=812, ~13%) so the two never share a row regardless
       of sidebar width. */
    top: 19%;
    bottom: 10%;
    width: 33%;
    display: flex;
    flex-direction: column;
    opacity: 0;
    pointer-events: none;
    transition: opacity 450ms ease;
  }

  /* The EcCard fills the sidebar's whole footprint (rather than sitting
     inside additional padding) so its own 20px inset is the only inset —
     :global since EcCard's root element lives in its own component. */
  .moments-sidebar :global(.ec-card) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Only the bin list scrolls — the heading (and its info tooltip) stays
     outside any overflow:auto ancestor, so the tooltip is never clipped by
     the scroll container regardless of scroll position. */
  .moments-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .moments-sidebar.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .moments-heading {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.4rem;
  }

  .moments-sidebar h3 {
    margin: 0;
    font-size: var(--ec-text-h5); /* DS H4 label, 20px */
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface);
  }

  .info-wrap {
    position: relative;
    display: inline-flex;
  }

  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--ec-on-surface-muted);
    background: none;
    font-family: inherit;
    font-size: 0.7rem;
    font-style: italic;
    font-weight: var(--ec-weight-bold);
    color: var(--ec-on-surface-muted);
    cursor: help;
  }

  /* CSS-driven, not a native `title` tooltip — a native tooltip's browser
     debounce means it won't reliably re-show on a second hover of the same
     element without first moving away for a beat. This shows every time.
     Uses the chip token pair (not --ec-surface/--ec-on-surface) because a
     tooltip is a small overlay that must read as "on top of" the page
     regardless of which theme is active — see ec-tokens.css's comment on
     why that pair inverts in dark mode instead of tracking the surface. */
  .info-tooltip {
    position: absolute;
    top: 130%;
    left: 0;
    z-index: 20;
    width: 18rem;
    padding: 0.6rem 0.75rem;
    background: var(--ec-chip-surface);
    color: var(--ec-chip-on-surface);
    font-size: var(--ec-text-caption);
    line-height: var(--ec-leading-normal);
    border-radius: var(--ec-radius-sm);
    box-shadow: var(--ec-shadow-sm);
    opacity: 0;
    visibility: hidden;
    transition: opacity 120ms ease;
    pointer-events: none;
  }

  .info-icon:hover + .info-tooltip,
  .info-icon:focus-visible + .info-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .moments-intro {
    margin: 0 0 0.85rem;
    font-size: var(--ec-text-caption);
    line-height: 1.4;
    color: var(--ec-on-surface-muted);
  }

  .moments-bin {
    margin-bottom: 1rem;
  }

  .moments-bin-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border-bottom: 2px solid var(--ec-hairline);
    padding-bottom: 0.3rem;
  }

  .bin-badge {
    flex: 0 0 auto;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    /* color set inline per bin (BIN_STYLE[...].onBadge) — the four fills
       don't share one contrast-safe text color, see BIN_STYLE's comment. */
    font-size: var(--ec-text-xs);
    font-weight: var(--ec-weight-bold);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .bin-title {
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-bold);
    color: var(--ec-on-surface);
    line-height: 1.25;
  }

  /* Not colored per-bin like the badge/border above — bin-meta is real
     caption text ("N policy concepts · composite range"), so it needs
     WCAG's 4.5:1 text-contrast floor rather than the 3:1 (or looser, for a
     purely decorative rule) floor a divider gets; two of the four BIN_STYLE
     fills (the orange and the light gray) can't clear that against the
     card surface at this size. The badge's own color-coding already carries
     bin identity, so this just stays the ordinary muted body color. */
  .bin-meta {
    margin: 0.25rem 0 0.5rem;
    font-size: var(--ec-text-caption);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface-muted);
  }

  .moments-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .moments-list summary {
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    cursor: pointer;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--ec-hairline);
  }

  .moments-list summary::-webkit-details-marker {
    display: none;
  }

  .moments-list summary:hover .concept-name,
  .moments-list summary:focus-visible .concept-name {
    color: var(--ec-link);
  }

  .moments-list summary:focus-visible {
    outline: none;
  }

  .moments-list details[open] .concept-quotes {
    border-bottom: 1px solid var(--ec-link);
  }

  .concept-name {
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface);
    line-height: 1.35;
  }

  .concept-quotes {
    padding: 0.6rem 0 0.5rem;
  }

  .concept-empty {
    margin: 0.3rem 0 0.6rem;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
  }

  blockquote {
    margin: 0 0 0.7rem;
    padding: 0;
  }

  .quote-text {
    margin: 0 0 0.2rem;
    font-size: var(--ec-text-body-sm);
    line-height: var(--ec-leading-normal);
    color: var(--ec-on-surface);
  }

  .quote-byline {
    margin: 0;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
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
