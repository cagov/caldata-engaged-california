<script lang="ts">
  /**
   * "The power of the discussion" — a white-page, cut-down sibling of
   * ParticipantFunnelCloudConcepts.svelte that shows only its stages 5-7
   * (Behind the curtain / Moments / Phase 1 -> Phase 2), switched by a
   * 3-option toggle instead of an auto-advancing timeline, with its top
   * matter as real DOM (FunnelSectionHeader.svelte) instead of that file's
   * canvas-drawn header(). No stage 0-4 ever happens here: the ring is
   * seeded already-assembled at mount, exactly as if stage 4
   * ("Conversations") had just settled — there is no funnel-in to animate
   * from. Per this codebase's own "copy, don't share" convention
   * (ParticipantFunnelSelection.svelte's header comment; DeliberationRooms
   * vs DeliberationRoomsByPopularity.svelte), this is a separate, cut-down
   * file, not a shared refactor of ParticipantFunnelCloudConcepts.svelte —
   * that file's own stage machine can't regress from anything here.
   *
   * Every draw function below that ParticipantFunnelCloudConcepts.svelte
   * already branches on absolute stage numbers (facilitators(),
   * isClusterDimmed(), clusterCenter(), clockFor(), conversationBadges(),
   * curtainCenterLabel(), momentCenterLabel()) is copied verbatim,
   * including disjuncts like `stage === 4 || stage === 5` — `stage` here
   * only ever takes the values 5, 6, or 7 (see discussionSection.ts's
   * libStageFor), so a `stage === 4` clause is simply dead and harmless,
   * not wrong. Keeping the exact original conditions, rather than
   * simplifying them, is what makes this a safe copy instead of a
   * re-derivation.
   *
   * Dropped entirely, since dotTarget() never returns `person: true` for
   * any stage in {5, 6, 7}: the person-glyph crossfade (personGlyph.ts,
   * stampPerson, RenderDot.person/pFrom), stage 1's word-cloud toggle
   * (PhaseOneConceptCloud.svelte, wordsK), and header()/COPY (replaced by
   * FunnelSectionHeader.svelte + discussionSection.ts). Also dropped: every
   * dwell/looping/playing/restart auto-advance control — this section holds
   * on whichever view is selected until the toggle changes, never on a
   * timer (confirmed with the user: no transport at all).
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
  import { PHASE1_CONCEPTS } from "../lib/phase1ConceptsData.ts";
  import { wrapLabel } from "../lib/labels.ts";
  import { watchEcTokens, type EcCanvasTokens } from "../lib/ecCanvasTokens.ts";
  import { DISCUSSION_HEADING, buildDiscussionViews, libStageFor, viewIndexFor } from "../lib/discussionSection.ts";
  import { headerCrossfade } from "../lib/funnelSection.ts";
  import EcButton from "./ec/EcButton.svelte";
  import EcCard from "./ec/EcCard.svelte";
  import EcGlyph from "./ec/EcGlyph.svelte";
  import EcStatusPill from "./ec/EcStatusPill.svelte";
  import ConversationPeekCard from "./ConversationPeekCard.svelte";
  import PhaseDistillationFinale from "./PhaseDistillationFinale.svelte";
  import FunnelSectionHeader from "./FunnelSectionHeader.svelte";

  let { data, rooms, insights = null }: { data: FunnelData & { meta: { sampleCaveat: string } }; rooms: RoomsData; insights?: InsightsData | null } =
    $props();

  function insightOf(conceptId: string) {
    return insights?.concepts[conceptId];
  }

  const layout = $derived(buildFunnelCloud(data));

  // Moments view data — every rooms.json concept, grouped into popularity
  // bins and joined to this layout's own clusters. See
  // deliberativeMoments.ts's header comment for why this is one of the only
  // two places funnel and rooms data are allowed to meet.
  const momentGroups = $derived(buildMomentGroups(rooms, layout.clusters));
  const allMomentConcepts = $derived(momentGroups.flatMap((g) => g.concepts));

  const VIEWS = $derived(buildDiscussionViews(layout.clusters.length, allMomentConcepts.length, PHASE1_CONCEPTS.length));

  const BIN_STYLE: Record<PopularityBin, { badge: string; onBadge: string }> = {
    "most popular": { badge: "#1C2745", onBadge: "#FFF4EB" },
    popular: { badge: "#274D7D", onBadge: "#FFF4EB" },
    "less popular": { badge: "#E6883B", onBadge: "#1C2745" },
    "least popular": { badge: "#BCBBC1", onBadge: "#1C2745" },
  };

  const linkedIdeasCount = $derived(rooms.ideas.filter((i) => i.conceptId !== null).length);
  const linkageCoveragePct = $derived(Math.round(rooms.meta.linkageCoverage * 100));

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
  function conceptSeed(conceptId: string): number {
    return parseInt(conceptId.replace(/\D/g, ""), 10) || 0;
  }

  // "Behind the curtain" view data — one placeholder chat per cluster.
  const conversationPeeks = $derived(buildConversationPeeks(layout.clusters, rooms, (ci) => attendeesByCluster.get(ci) ?? [], insights));

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

  let stageHeightPx = $state(0);
  let peekCardHeightPx = $state(0);

  // The right-hand panel's own width, as a fraction of #stage — the peek
  // card (stage 5) and moments sidebar (stage 6) both occupy this same
  // fraction (see their own .peek-panel/.moments-sidebar CSS, kept in sync
  // with this value by hand — Svelte's scoped CSS can't read a script
  // const). categoryLegend() and leaderLine both read this so neither ever
  // draws past the panel's actual left edge.
  const SIDEBAR_WIDTH_FRAC = 0.38;

  // canvas-space y -> 0-1 fraction of #stage's own (TOP_TRIM-shortened)
  // height — see TOP_TRIM's doc comment below for why this divides by
  // VIEW_H, not CANVAS.H, unlike the funnel-cloud-concepts original this is
  // ported from (that file's canvas is never trimmed).
  const VIEW_H = CANVAS.H - 100;
  const vFrac = (y: number) => (y - TOP_TRIM) / VIEW_H;

  const peekPanelFrac = $derived.by(() => {
    if (!activePeek || stageHeightPx === 0) return { top: 0.16, height: 0.3 };
    const cluster = layout.clusters[activePeek.clusterIndex];
    if (!cluster) return { top: 0.16, height: 0.3 };
    const height = peekCardHeightPx > 0 ? peekCardHeightPx / stageHeightPx : 0.3;
    const desiredTop = vFrac(cluster.y) - height / 2;
    const top = Math.min(Math.max(desiredTop, 0.16), 1 - height - 0.12);
    return { top, height };
  });

  const leaderLine = $derived.by(() => {
    if (!activePeek) return null;
    const cluster = layout.clusters[activePeek.clusterIndex];
    if (!cluster) return null;
    const x1 = cluster.x - RING_SHIFT_X + cluster.rc + 8;
    const y1 = cluster.y;
    const x2 = CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC);
    const y2 = TOP_TRIM + (peekPanelFrac.top + peekPanelFrac.height / 2) * VIEW_H;
    return { d: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${y1} ${x2} ${y2}` };
  });

  let hoveredConceptId = $state<string | null>(null);
  let openConceptId = $state<string | null>(null);
  const activeConceptId = $derived(hoveredConceptId ?? openConceptId);
  const activeConcept = $derived<MomentConcept | null>(
    activeConceptId === null ? null : allMomentConcepts.find((c) => c.id === activeConceptId) ?? null,
  );
  const highlightedClusterIndexes = $derived(new Set(activeConcept ? activeConcept.contributing.map((s) => s.clusterIndex) : []));
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

  const MOTION_OPTIONS: { key: MotionMode; label: string }[] = [
    { key: "orbit", label: "Orbit" },
    { key: "pulse", label: "Pulse" },
  ];
  let motion = $state<MotionMode>("orbit");

  const categories = $derived(dimension === "region" ? data.regions : data.fieldOfWork);

  // Dev-only palette A/B — see ParticipantFunnelCloudConcepts.svelte's
  // identical toggle for the full rationale. Carried over per the user's
  // explicit request; delete along with that file's copy once the review
  // settles.
  let paletteVersion = $state<"engaged" | "odi">("engaged");
  const PALETTE_RAMPS = { engaged: DATA_VIZ_CAT_V2, odi: DATA_VIZ_CAT_OLD };
  const categoryColors = $derived(assignCategoryColors(categories.map((c) => c.name), PALETTE_RAMPS[paletteVersion]));
  const colorOf = $derived(new Map(categories.map((c, i) => [c.name, categoryColors[i]])));

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

  const TRANSITION_MS = 1400;
  const ORBIT_SPEED = 0.2;
  const DRIFT_SPEED = 0.3;

  // The DOM header replaces this canvas's top band (same trick
  // ParticipantFunnelSelection.svelte's TOP_TRIM introduced) — the canvas
  // element itself is shortened by this many canvas-space px, and resize()'s
  // setTransform shifts the *visible window* over the unchanged coordinate
  // space rather than moving any of funnelCloud.ts's own tuned constants.
  // 100, not that file's 120: drawPhase1Cloud() (phase1CloudDraw.ts) never
  // paints above phase1Cloud.ts's FIELD_TOP (125 in its own 1100x920 space),
  // which lands at 125 * 812/920 ≈ 110 canvas px here — 100 leaves that
  // headroom, while still clearing this section's own header.
  const TOP_TRIM = 100;

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
  }

  let renders: RenderDot[] = [];
  let clock = 0;
  let clusterClock: number[] = [];
  // Only ever 5 (Behind the curtain), 6 (Moments), or 7 (Concepts) — see
  // discussionSection.ts's libStageFor. Every draw function below still
  // checks these exact absolute numbers, matching
  // ParticipantFunnelCloudConcepts.svelte's own numbering, so nothing here
  // has to re-derive what those numbers mean.
  let stage = $state(5);
  let prevStage = 5;
  let t = 1;
  let reduced = false;
  let rafId = 0;
  let lastTime = 0;
  let hoverK = 0;
  const HOVER_EASE_MS = 180;
  let titleK = 0;
  const TITLE_EASE_MS = 900;

  // The DOM header's own crossfade state, updated once a frame from
  // funnelSection.ts's headerCrossfade(t) — same split
  // ParticipantFunnelSelection.svelte uses.
  let headerOpacity = $state(1);
  let headerViewIndex = $state(0);

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let peekPanelEl: HTMLDivElement | null = null;

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

  // The "concepts" view's own stat should count down from the Phase 1 side
  // to the real Phase 2 total as PhaseDistillationFinale.svelte's animation
  // actually merges them, not snap to 27 the moment the toggle switches —
  // conceptsProgress is that component's own hold0/distill/hold1 clock,
  // bound back up here (see PhaseDistillationFinale.svelte's own `progress`
  // doc comment). PHASE1_CONCEPTS' 126 children (verbatim from the same
  // sketch this animation is ported from) are the exact figure the
  // animation itself visually starts from — see phase1ConceptsData.ts's
  // header comment.
  const phase1ConceptChildCount = PHASE1_CONCEPTS.reduce((a, c) => a + c.from.length, 0);
  let conceptsProgress = $state(0);
  const HEADER_VIEWS = $derived(
    VIEWS.map((v, i) =>
      i === 2 && v.stat
        ? { ...v, stat: { ...v.stat, value: String(Math.round(lerp(phase1ConceptChildCount, PHASE1_CONCEPTS.length, conceptsProgress))) } }
        : v,
    ),
  );
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

  // Which clock a dot's orbit/pulse position should read: its own cluster's
  // activity clock while a highlight can pause it (5-6), the shared global
  // `clock` otherwise.
  function clockFor(dot: FunnelDot): number {
    if ((stage === 4 || stage === 5 || stage === 6) && dot.group >= 0) return clusterClock[dot.group] ?? clock;
    return clock;
  }

  function resetRenders() {
    renders = layout.dots.map((dot) => {
      const g = dotTarget(dot, stage, dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
      const c = colorFor(g.categoryKey);
      return { pos: [g.x, g.y], from: [g.x, g.y], alpha: g.alpha, aFrom: g.alpha, r: g.r, rFrom: g.r, cNow: c, cFrom: c, delay: 0 };
    });
  }

  function place(render: RenderDot, g: ReturnType<typeof dotTarget>, lt: number) {
    if (g.viaX !== undefined && g.viaY !== undefined) {
      const u = 1 - lt;
      render.pos[0] = u * u * render.from[0] + 2 * u * lt * g.viaX + lt * lt * g.x;
      render.pos[1] = u * u * render.from[1] + 2 * u * lt * g.viaY + lt * lt * g.y;
    } else {
      render.pos[0] = lerp(render.from[0], g.x, lt);
      render.pos[1] = lerp(render.from[1], g.y, lt);
    }
  }

  // Moves to a new view's underlying dotTarget stage (5, 6, or 7) — the
  // toggle's only job. No timer ever calls this; see this file's own header
  // comment.
  function goTo(nextStage: number) {
    if (nextStage === stage && t >= 1) return;
    prevStage = stage;
    stage = nextStage;
    t = reduced ? 1 : 0;
    hoveredPeekIndex = null;
    pinnedPeekIndex = null;
    hoveredConceptId = null;
    openConceptId = null;
    curtainReady = nextStage === 5 && reduced;
    momentsSidebarReady = nextStage === 6 && reduced;
    ringReady = (nextStage === 4 || nextStage === 5) && reduced;
    layout.dots.forEach((dot, i) => {
      const r = renders[i];
      r.from = [r.pos[0], r.pos[1]];
      r.aFrom = r.alpha;
      r.rFrom = r.r;
      r.cFrom = r.cNow;
      r.delay = (dot.kept ? 0 : 0.1) + Math.random() * (dot.kept ? 0.22 : 0.3);
    });
    if (reduced) snapValues();
  }

  function goToView(view: number) {
    goTo(libStageFor(view));
  }

  function snapValues() {
    layout.dots.forEach((dot, i) => {
      const g = dotTarget(dot, stage, dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
      const r = renders[i];
      r.pos = [g.x, g.y];
      r.alpha = g.alpha;
      r.r = g.r;
      r.cNow = colorFor(g.categoryKey);
    });
  }

  let momentsSidebarReady = $state(false);
  let curtainReady = $state(false);
  let ringReady = false;

  function clusterCenter(cluster: Cluster): [number, number] {
    return stage === 5 || stage === 6 ? [cluster.x - RING_SHIFT_X, cluster.y] : [cluster.x, cluster.y];
  }

  function isClusterDimmed(clusterIndex: number): boolean {
    const conceptHighlightActive = stage === 6 && activeConceptId !== null;
    const peekHighlightActive = stage === 5 && activePeekIndex !== null;
    return (conceptHighlightActive && !highlightedClusterIndexes.has(clusterIndex)) || (peekHighlightActive && clusterIndex !== activePeekIndex);
  }

  function facilitators() {
    if (!ctx) return;
    const vis = stage === 4 || stage === 5 || stage === 6 ? easeInOut(Math.max(0, (t - 0.45) / 0.55)) : 0;
    if (vis <= 0.01) return;

    const conceptHighlightActive = stage === 6 && activeConceptId !== null;
    const peekHighlightActive = stage === 5 && activePeekIndex !== null;
    layout.clusters.forEach((cl, clusterIndex) => {
      const dimmed = isClusterDimmed(clusterIndex);
      const mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      ctx!.globalAlpha = vis * mult;
      const [cx, cy] = clusterCenter(cl);

      if ((conceptHighlightActive && topVotedClusterIndexes.has(clusterIndex)) || (peekHighlightActive && clusterIndex === activePeekIndex)) {
        const outlineR = motion === "pulse" ? (cl.rc + 4) * (1 + PULSE_AMPLITUDE * Math.sin(((clusterClock[clusterIndex] ?? 0) / cl.pulsePeriod) * Math.PI * 2 + cl.pulsePhase)) : cl.rc + 4;
        ctx!.globalAlpha = vis * hoverK;
        ctx!.beginPath();
        ctx!.arc(cx, cy, outlineR, 0, Math.PI * 2);
        ctx!.strokeStyle = OUTLINE;
        ctx!.lineWidth = 1;
        ctx!.stroke();
        ctx!.globalAlpha = vis;
      }

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
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `400 14px ${WORD_FONT}`;
    // Sits in the one band this row is guaranteed clear of both neighbors:
    // right of .dimension-toggle's own right edge (that pill's "Region" +
    // "Field of work" segments run to roughly x=260 at CANVAS.W's scale),
    // and left of the peek/moments panel's actual left edge
    // (CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC) ≈ 645) with margin to spare even
    // at "Facilitator"'s measured width. An earlier version right-aligned
    // this row at x=980 to clear the toggle — which moved it, unnoticed,
    // straight underneath the panel instead, hidden behind that panel's own
    // opaque card rather than merely overlapping something visible. Fixed
    // at x=300, not right-aligned, since nothing here needs to track either
    // neighbor's own width to stay clear of both.
    const lx = 300;
    const ly = CANVAS.H - 108;
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

    ctx.fillText("Participant", lx + 12, ly);
    ctx.fillText("Facilitator", lx + 120, ly);

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

  function momentCenterLabel() {
    if (!ctx || stage !== 6 || t < 1 || !activeConcept || hoverK <= 0.01) return;
    const cx = CX - RING_SHIFT_X;
    const cy = CY;
    const maxClusterRc = Math.max(...layout.clusters.map((c) => c.rc), 0);
    const freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    const CHAR_WIDTH_PX = 8.9;
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

  function curtainCenterLabel() {
    if (!ctx || titleK <= 0.01) return;
    const cx = stage === 5 || stage === 6 ? CX - RING_SHIFT_X : CX;
    const cy = CY;
    const maxClusterRc = Math.max(...layout.clusters.map((c) => c.rc), 0);
    const freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    const maxWidth = freeRadius * 1.7;
    const lineHeight = 22;
    const gap = 6;

    const showPrompt = stage === 5 || (stage === 6 && titleK > 0.01);
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

  function conversationBadges() {
    if (!ctx || stage !== 5) return;
    const vis = easeInOut(Math.max(0, (t - 0.45) / 0.55));
    if (vis <= 0.01) return;

    layout.clusters.forEach((cl, clusterIndex) => {
      const peek = conversationPeeks[clusterIndex];
      const isActive = activePeekIndex === clusterIndex;
      const [ccx, ccy] = clusterCenter(cl);
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
    ctx.font = `400 14px ${WORD_FONT}`;
    ctx.textBaseline = "middle";
    const SW = 9,
      GAP = 7,
      PAD = 22;
    const w = categories.map((c) => SW + GAP + ctx!.measureText(c.name).width + PAD);

    // Behind the curtain (5) and Moments (6) both show a right-hand panel
    // (the peek card or the moments sidebar — see SIDEBAR_WIDTH_FRAC's own
    // comment) that this legend used to draw straight underneath, since
    // both the row-wrap width and the per-row centering below assumed the
    // full canvas was free. Reserving the panel's own width here — for
    // both the wrap decision and where a row centers — is what keeps every
    // row's legend text to the left of it instead of relying on the
    // panel's opaque card to cover whatever ran past its edge.
    // Reserved unconditionally for both stages, not just while a peek/
    // concept is actually pinned open — stage 5's peek card can appear on
    // any hover, and reflowing the legend's own row layout every time it
    // does would read as the legend itself jittering in response to an
    // unrelated hover, worse than it staying at a consistent (slightly more
    // conservative) layout the whole time either stage is active.
    const panelShowing = stage === 5 || stage === 6;
    const freeWidth = panelShowing ? CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC) : CANVAS.W;

    const total = w.reduce((a, b) => a + b, 0);
    const nRows = Math.max(1, Math.ceil(total / (freeWidth - 90)));
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
      let x = (freeWidth - (row.reduce((a, i) => a + w[i], 0) - PAD)) / 2;
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

  const fmt = (n: number) => n.toLocaleString("en-US");

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, TOP_TRIM, CANVAS.W, CANVAS.H - TOP_TRIM);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, TOP_TRIM, CANVAS.W, CANVAS.H - TOP_TRIM);

    for (let i = 0; i < layout.dots.length; i++) {
      const r = renders[i];
      if (!r || r.alpha <= 0.008) continue;
      const dot = layout.dots[i];
      const conceptActive = stage === 6 && activeConceptId !== null && dot.kept;
      const peekActive = stage === 5 && activePeekIndex !== null && dot.kept;
      const dimmed = (conceptActive && !highlightedClusterIndexes.has(dot.group)) || (peekActive && dot.group !== activePeekIndex);
      const mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      ctx.fillStyle = css(r.cNow);
      ctx.globalAlpha = r.alpha * mult;
      ctx.beginPath();
      ctx.arc(r.pos[0], r.pos[1], r.r, 0, Math.PI * 2);
      ctx.fill();
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

    const cross = headerCrossfade(t);
    headerOpacity = cross.opacity;
    headerViewIndex = cross.useTo ? viewIndexFor(stage) : viewIndexFor(prevStage);

    const hoverTarget = (stage === 6 && activeConceptId !== null) || (stage === 5 && activePeekIndex !== null) ? 1 : 0;
    hoverK += (hoverTarget - hoverK) * Math.min(1, dt / HOVER_EASE_MS);

    const titleTarget = (stage === 4 || stage === 5) && ringReady ? 1 : 0;
    if (titleTarget === 0 && (stage === 4 || stage === 5)) titleK = 0;
    else titleK += (titleTarget - titleK) * Math.min(1, dt / TITLE_EASE_MS);

    clock += dt / 1000;
    layout.clusters.forEach((_, i) => {
      const activity = isClusterDimmed(i) ? lerp(1, 0, hoverK) : 1;
      clusterClock[i] = (clusterClock[i] ?? 0) + (dt / 1000) * activity;
    });

    if (t < 1) {
      t = Math.min(1, t + dt / TRANSITION_MS);
      const span = 0.7;
      layout.dots.forEach((dot, i) => {
        const g = dotTarget(dot, stage, dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
        const r = renders[i];
        const lt = easeInOut(Math.max(0, Math.min(1, (t - r.delay) / span)));
        place(r, g, lt);
        r.alpha = lerp(r.aFrom, g.alpha, lt);
        r.r = lerp(r.rFrom, g.r, lt);
        r.cNow = mixColor(r.cFrom, colorFor(g.categoryKey), lt);
      });
      if (t >= 1) {
        if (stage === 5) curtainReady = true;
        if (stage === 6) momentsSidebarReady = true;
        if (stage === 4 || stage === 5) ringReady = true;
      }
    }

    // Runs every frame once settled (t>=1), independent of whether this is
    // the same frame a transition just completed — this is what keeps the
    // Region/Field-of-work toggle and the ring's own orbit/pulse motion live
    // while a view sits idle with no transition in flight.
    if (t >= 1) {
      layout.dots.forEach((dot, i) => {
        if ((stage === 4 || stage === 5 || stage === 6) && !dot.kept) return;
        const g = dotTarget(dot, stage, dimension, layout.clusters, clockFor(dot), DRIFT_SPEED, ORBIT_SPEED, motion);
        renders[i].pos[0] = g.x;
        renders[i].pos[1] = g.y;
        renders[i].cNow = colorFor(g.categoryKey);
      });
    }

    draw();
    rafId = requestAnimationFrame(frame);
  }

  // Seeds the view already-assembled at its resting state — there is no
  // stage 0-4 flight to arrive from, so t starts at 1 and curtainReady/
  // ringReady start true rather than waiting for a transition that will
  // never happen.
  function init() {
    clock = 0;
    clusterClock = layout.clusters.map(() => 0);
    stage = 5;
    prevStage = 5;
    t = 1;
    curtainReady = true;
    momentsSidebarReady = false;
    ringReady = true;
    hoveredPeekIndex = null;
    pinnedPeekIndex = null;
    resetRenders();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && (openConceptId !== null || pinnedPeekIndex !== null)) {
      openConceptId = null;
      pinnedPeekIndex = null;
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (stage !== 5 || pinnedPeekIndex === null) return;
    if (peekPanelEl?.contains(e.target as Node)) return;
    pinnedPeekIndex = null;
  }

  function resize() {
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || CANVAS.W;
    const scale = cssWidth / CANVAS.W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvasH = CANVAS.H - TOP_TRIM;
    canvas.width = CANVAS.W * scale * dpr;
    canvas.height = canvasH * scale * dpr;
    canvas.style.height = `${canvasH * scale}px`;
    ctx = canvas.getContext("2d");
    ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, -TOP_TRIM * scale * dpr);
  }

  // Same untrack() guard ParticipantFunnelCloudConcepts.svelte/
  // ParticipantFunnelSelection.svelte both carry: init() incidentally reads
  // `stage`/`dimension` (through resetRenders -> dotTarget) to seed initial
  // render state; without untrack(), that read would make THIS effect
  // depend on `stage` too, so every later goTo() would re-fire it and snap
  // the view back to "Behind the curtain".
  $effect(() => {
    void layout;
    untrack(() => init());
  });

  let stopWatchingEcTokens: (() => void) | null = null;

  onMount(() => {
    reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    resize();
    window.addEventListener("resize", resize);
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

<div class="discussion-section">
  <FunnelSectionHeader heading={DISCUSSION_HEADING} stage={HEADER_VIEWS[headerViewIndex]} opacity={headerOpacity} infoText="" />

  <div class="view-toggle" role="group" aria-label="Which view of the discussion to show">
    {#each VIEWS as v, i (v.key)}
      <button type="button" class="view-option" aria-pressed={stage === libStageFor(i)} onclick={() => goToView(i)}>
        {v.pill}
      </button>
    {/each}
  </div>

  <div id="stage" bind:clientHeight={stageHeightPx}>
    <canvas
      bind:this={canvas}
      width={CANVAS.W}
      height={CANVAS.H - TOP_TRIM}
      aria-label={`Animation showing ${fmt(layout.keptTotal)} phase 2 attendees seated in their ${layout.clusters.length} real conversation groups, arranged in a ring and colored by ${dimension === "region" ? "region" : "field of work"}. One view lets you open any conversation to see a placeholder chat from that room. Another lists the ${allMomentConcepts.length} policy concepts those conversations raised, letting you hover one to see which conversations raised it. A third plays an animation in which placeholder Phase 1 concepts merge into the ${PHASE1_CONCEPTS.length} real Phase 2 policy concepts.`}
    ></canvas>

    <div class="dimension-toggle" role="group" aria-label="Color dots by">
      {#each DIMENSION_OPTIONS as opt}
        <button type="button" class="dimension-option" aria-pressed={dimension === opt.key} onclick={() => (dimension = opt.key)}>
          {opt.label}
        </button>
      {/each}
    </div>

    <PhaseDistillationFinale active={stage === 7} playing={true} looping={true} {paletteVersion} topTrim={TOP_TRIM} bind:progress={conceptsProgress} />

    {#if stage === 5 && leaderLine}
      <svg class="peek-leader" viewBox="0 {TOP_TRIM} {CANVAS.W} {VIEW_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path d={leaderLine.d} fill="none" stroke={OUTLINE} stroke-width="1.5" />
      </svg>
    {/if}

    {#each layout.clusters as cluster, ci (ci)}
      {@const peek = conversationPeeks[ci]}
      <button
        type="button"
        class="peek-hotspot"
        style="left: {((cluster.x - RING_SHIFT_X) / CANVAS.W) * 100}%; top: {vFrac(cluster.y) *
          100}%; width: {((2 * cluster.rc) / CANVAS.W) * 100}%; height: {((2 * cluster.rc) / VIEW_H) * 100}%"
        aria-label={`Conversation ${peek?.sessionNumber ?? ci + 1}, ${peek?.attendeeCount ?? 0} people, ${peek?.dateLabel ?? ""}`}
        aria-pressed={pinnedPeekIndex === ci}
        inert={!(stage === 5 && curtainReady)}
        tabindex={stage === 5 && curtainReady ? 0 : -1}
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
      class:visible={stage === 5 && activePeek !== null}
      inert={!(stage === 5 && activePeek !== null)}
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
                                    "{quote.text}"
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
    {#each MOTION_OPTIONS as opt}
      <EcButton variant="pill" pressed={motion === opt.key} onclick={() => (motion = opt.key)}>{opt.label}</EcButton>
    {/each}
  </div>

  <p class="hint">
    Toggle between Region and Field of work to recolor the same {layout.keptTotal} real phase 2 attendees by a
    different demographic — the set of people highlighted never changes, only what distinguishes them. {data.meta
      .sampleCaveat} {rooms.meta.sampleCaveat}
  </p>

  <div class="dev-palette-toggle">
    <span>Dev only — color palette review:</span>
    <button type="button" class:active={paletteVersion === "engaged"} onclick={() => (paletteVersion = "engaged")}>Engaged</button>
    <button type="button" class:active={paletteVersion === "odi"} onclick={() => (paletteVersion = "odi")}>ODI</button>
  </div>
</div>

<style>
  .discussion-section {
    font-family: var(--ec-font-sans);
    color: var(--ec-on-surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }

  /* The mockups' own control language — a single joined segmented control
     (same recipe as .dimension-toggle below, one step up in type), not
     EcButton's pill variant, which can't express a joined pair sharing one
     border (see ParticipantFunnelSelection.svelte's identical .dimension-option
     comment). Left-aligned to the header's own 5.77% margin, above it, so
     it reads as this section's one persistent piece of chrome regardless of
     which view is showing. */
  .view-toggle {
    width: 100%;
    max-width: 1040px;
    padding: 0 5.77%;
    box-sizing: border-box;
    display: flex;
    justify-content: flex-start;
  }

  .view-option {
    font: inherit;
    font-family: var(--ec-font-sans);
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-semibold);
    padding: 8px 20px;
    border: 1px solid var(--ec-navy);
    border-right-width: 0;
    cursor: pointer;
    background: var(--ec-surface-alt);
    color: var(--ec-link);
  }

  .view-option:first-child {
    border-radius: var(--ec-pill-radius) 0 0 var(--ec-pill-radius);
  }

  .view-option:last-child {
    border-right-width: 1px;
    border-radius: 0 var(--ec-pill-radius) var(--ec-pill-radius) 0;
  }

  .view-option[aria-pressed="true"] {
    background: var(--ec-navy);
    color: var(--ec-text-light);
  }

  .view-option:focus-visible {
    outline: 2px solid var(--ec-link);
    outline-offset: -2px;
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

  /* Bottom-left, matching ParticipantFunnelSelection.svelte's own
     .dimension-toggle (the "how we got to this list" styling this section's
     brief asks to match) rather than ParticipantFunnelCloudConcepts.svelte's
     centered version. left is the same 5.77% margin FunnelSectionHeader.svelte
     and categoryLegend()'s x=60 both use; bottom is a percentage of the
     TOP_TRIM-shortened canvas (VIEW_H, not CANVAS.H), tuned to the same ~81px
     absolute clearance above categoryLegend()'s own rows that file's toggle
     targets. */
  .dimension-toggle {
    position: absolute;
    left: 5.77%;
    bottom: 11.38%;
    display: inline-flex;
    border-radius: var(--ec-pill-radius);
    overflow: hidden;
    border: 1px solid var(--ec-navy);
  }

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

  .peek-hotspot {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  .peek-leader {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* SIDEBAR_WIDTH_FRAC (0.38, see categoryLegend()'s own const of the same
     value in the script above) is this literal 38% — the two can't share
     one source (Svelte's scoped CSS can't read a script const), so keep
     them in sync by hand if either changes. Widened from the
     funnel-cloud-concepts original's 33%: at that width, categoryLegend()'s
     centered rows (unaware of this panel) ran underneath its left edge
     rather than stopping short of it — categoryLegend() now reserves this
     exact width so its rows never reach here, instead of this panel's own
     opaque card covering whatever legend text ended up behind it. */
  .peek-panel {
    position: absolute;
    right: 0;
    width: 38%;
    opacity: 0;
    pointer-events: none;
    transition: opacity 300ms ease;
  }

  .peek-panel.visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* top/bottom are a visual tune, not a derived number — the funnel-cloud-
     concepts original's `top: 19%` existed only to clear that file's own
     canvas-drawn header() sub-line, which doesn't exist here at all (this
     section's header is DOM, entirely above #stage). */
  .moments-sidebar {
    position: absolute;
    right: 0;
    top: 4%;
    bottom: 8%;
    width: 38%;
    display: flex;
    flex-direction: column;
    opacity: 0;
    pointer-events: none;
    transition: opacity 450ms ease;
  }

  .moments-sidebar :global(.ec-card) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* The mockups' own card treatment on white — a 1px warm-orange outline
     with no shadow, where EcCard.svelte ships --ec-surface-alt fill +
     --ec-shadow-sm and no border. Scoped to this prototype's own cards
     (:global since EcCard's root lives in its own component) rather than a
     new EcCard variant three other prototypes would inherit for free. */
  .discussion-section :global(.ec-card) {
    border: 1px solid var(--ec-orange);
    border-radius: var(--ec-radius-md);
    box-shadow: none;
  }

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
    gap: 6px;
  }

  .moments-heading h3 {
    margin: 0;
    font-size: var(--ec-text-h5);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface);
  }

  .moments-intro {
    margin: 6px 0 12px;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
  }

  .moments-bin {
    padding: 10px 0;
    border-top: 1px solid var(--ec-hairline);
  }

  .moments-bin:first-child {
    border-top: none;
    padding-top: 0;
  }

  .moments-bin-header {
    display: flex;
    align-items: center;
    gap: 8px;
    border-left: 3px solid;
    padding-left: 8px;
  }

  .bin-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: var(--ec-text-xs);
    font-weight: var(--ec-weight-bold);
    flex: 0 0 auto;
  }

  .bin-title {
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface);
  }

  .bin-meta {
    margin: 4px 0 8px;
    font-size: var(--ec-text-xs);
    color: var(--ec-on-surface-muted);
  }

  .moments-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .moments-list summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    cursor: pointer;
    list-style: none;
    font-size: var(--ec-text-body-sm);
    color: var(--ec-on-surface);
  }

  .moments-list summary::-webkit-details-marker {
    display: none;
  }

  .concept-name {
    flex: 1 1 auto;
    min-width: 0;
  }

  .concept-quotes {
    padding: 0 0 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .concept-empty {
    margin: 0;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
  }

  blockquote {
    margin: 0;
    padding: 0 0 0 10px;
    border-left: 2px solid var(--ec-hairline);
  }

  .quote-text {
    margin: 0 0 2px;
    font-size: var(--ec-text-caption);
    line-height: var(--ec-leading-normal);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }

  .quote-byline {
    margin: 0;
    font-size: var(--ec-text-xs);
    color: var(--ec-on-surface-muted);
  }

  .info-wrap {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
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

  .hint {
    width: 100%;
    max-width: 1040px;
    font-size: var(--ec-text-body-sm);
    line-height: 1.55;
    color: var(--ec-on-surface-muted);
    margin: 0;
  }

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
</style>
