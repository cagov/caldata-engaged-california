/**
 * Pure, DOM-free layout for the participant-funnel-cloud prototype — ports
 * sketches/participant-funnel-region/participant-funnel-cloud-region.html's dot/cloud/funnel/
 * orbit math onto real data from funnelData.ts (FunnelCloud.svelte only
 * draws what this module computes), and generalizes it to a second
 * segmentation dimension (field of work) the reference sketch didn't have.
 *
 * The reference sketch drew its "kept" 103 dots by sampling a region purely
 * from FunnelData's aggregate REGION counts, since region was its only
 * dimension. With two dimensions, that trick breaks: sampling region and
 * field of work independently for the kept set would produce two different
 * 103-dot subsets — one whose region distribution is real, another whose
 * field-of-work distribution is real — so toggling the color dimension
 * would appear to swap out who "attended." Every kept dot here instead
 * carries one real attendee's actual (region, fieldOfWork) pair straight
 * from FunnelSession.attendees, so the same 103 dots stay kept, and stay
 * jointly consistent, under either toggle. Only the ~2600 dropped dots
 * (never real individuals, just a population's aggregate shape) get region
 * and field of work drawn independently, each proportional to the survey
 * counts remaining after subtracting the real attendees out of each
 * category.
 */

import { personHeightFor } from "./personGlyph.ts";

export interface FunnelCategory {
  name: string;
  surveyCount: number;
  attendCount: number;
}

export interface FunnelAttendee {
  region: string;
  fieldOfWork: string;
}

export interface FunnelSession {
  date: string;
  attendees: FunnelAttendee[];
}

export interface FunnelInvited {
  name: string;
  count: number;
}

export interface FunnelData {
  phase1Total: number;
  regions: FunnelCategory[];
  fieldOfWork: FunnelCategory[];
  sessions: FunnelSession[];
  invitedByRegion: FunnelInvited[];
  invitedTotal: number;
}

export type FunnelDimension = "region" | "fieldOfWork";

/** The conversation ring's ambient motion at stages 4-6 — "orbit" is the
 * original steady rotation, "pulse" is the alternative biomimicry-inspired
 * breathing motion (see orbitPosition). A view toggle, not stage data, so
 * ParticipantFunnelCloud.svelte's own state drives it the same way it
 * already drives `dimension`. */
export type MotionMode = "orbit" | "pulse";

// 8 stages: 0 Phase 1, 1 Phase 1 concepts, 2 Selected, 3 Phase 2/gather,
// 4 Conversations, 5 Behind the curtain, 6 Moments, 7 Phase 1 -> Phase 2.
export const STAGE_COUNT = 8;

/** How far left (in canvas px) the conversation ring slides for stage 5
 * ("Behind the curtain") and stays for stage 6 ("Deliberative moments"),
 * freeing space on the right for whichever right-hand panel that stage
 * shows — the conversation-peek card (ConversationPeekCard.svelte) or the
 * concepts sidebar (.moments-sidebar in ParticipantFunnelCloud.svelte), both
 * 33% of CANVAS.W wide since the EC design-system pass widened its type.
 * The ring slides once, on entering stage 5, and does not move again on the
 * advance to stage 6 — both panels share this column. Chosen so the ring's
 * own widest span (2 * max ringRadius, capped at 214 by buildFunnelCloud
 * below) still clears the canvas's left edge — center 520 - 215 = 305, ring
 * spans x 91-519, inside [0, 1040] — while leaving the panel's left edge
 * (1040 * (1 - 0.33) ~= 697) about 178px of clearance, comparable to the
 * ~154px the pre-EC 190/29% pair had. */
export const RING_SHIFT_X = 215;

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Fisher-Yates, seeded — same shuffle the reference sketch uses to
 * de-correlate category assignment from dot index. */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Draws `total` category assignments proportional to each category's
 * count, then shuffles — same "expand into a bag, shuffle" technique as the
 * reference sketch's regionOfDot. */
function proportionalDraw(counts: { name: string; count: number }[], rand: () => number): string[] {
  const bag: string[] = [];
  for (const { name, count } of counts) for (let i = 0; i < count; i++) bag.push(name);
  return shuffle(bag, rand);
}

export const CANVAS = { W: 1040, H: 812 };
// Exported — ParticipantFunnelCloud.svelte draws the hovered/open moments
// concept's name into the ring's own empty center, so it needs this same
// center point (minus the stage-4 MOMENTS_SHIFT_X, same as every other
// stage-4-shifted draw call) rather than a second, hand-copied constant.
export const CX = CANVAS.W / 2;
const CLOUD_Y = 285;
const GATHER_Y = 505;
const NECK_Y = 455;
export const CY = 435;
const BLOBS = 9;
// Each cluster's own internal seat pitch. Stages 3-6 now stamp an upright
// person glyph in place of the dot (personGlyph.ts) — taller than it is
// wide, so two adjacent seats can clear each other's width yet still have
// their glyphs' top/bottom overlap if the seats happen to sit almost
// directly above/below each other on the ring (a real case: some pair of
// seats always does, for *some* rotation of the orbit). 20 is a tradeoff,
// not the value that guarantees zero overlap at every clock tick — that
// value (~24+) would grow the largest real cluster's own radius (rc) past
// the point where it fits the 14-cluster ring's own ~96px neighbor-to-
// neighbor budget (the ring's radius is capped at 214, see ringRadius
// below). 20 keeps every cluster clear of its neighbors with room to spare
// and cuts the worst per-seat overlap area roughly two-thirds versus the
// plain-dot-era 15. funnelCloud.test.ts's overlap invariants pin both
// bounds; don't raise this without re-running them.
const SEAT_SPACING = 20;
// Exported — ParticipantFunnelSelection.svelte's selectionStageBands() (in
// funnelSection.ts) pads the cloud's measured extent by this same radius, so
// its vertical-centering math agrees with the actual drawn dot size rather
// than hand-copying the literal.
export const DOT_SIZE = 3.4;

// Pulse mode's ("orbitPosition"'s `mode` param) tuning — a slow shared
// rotation plus radial breathing, in place of orbit mode's steady spin.
// Exported so funnelCloud.test.ts can assert the exact formula rather than
// re-deriving it, same convention as RING_SHIFT_X/SPAN elsewhere in this app.
export const PULSE_AMPLITUDE = 0.08; // +/-8% of a seat's own orbit radius
export const PULSE_ROTATE_FRACTION = 0.08; // vs. orbit mode's full rotation rate
const PULSE_PERIOD_BASE = 8.8; // seconds per breath, before per-cluster jitter
const PULSE_PERIOD_JITTER = 0.3; // +/-15% around PULSE_PERIOD_BASE

interface Blob {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

function buildBlobs(rand: () => number): Blob[] {
  const blobs: Blob[] = [];
  for (let i = 0; i < BLOBS; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand());
    blobs.push({
      x: CX + Math.cos(a) * rr * 300,
      y: CLOUD_Y + Math.sin(a) * rr * 96,
      sx: 78 + rand() * 118,
      sy: 36 + rand() * 46,
    });
  }
  return blobs;
}

function packed(n: number, cx: number, cy: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996323;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

interface OrbitRing {
  r: number;
  count: number;
  rate: number;
}

// A two-ring cluster's inner and outer seats rotate at different rates
// (see the `rate` field below), so at some point in every orbit they land
// at the same angle — radially stacking an inner seat directly under an
// outer one. The gap between the two rings has to clear a stacked pair's
// full glyph height, not the old dot-era 17px, or that moment reads as one
// seat swallowing another. No real session in the current export is large
// enough to hit this path (max 12, single-ring up to n=14 at today's
// SEAT_SPACING), but it's fixed here rather than left as a landmine for
// whatever session sizes the next export brings. Deliberately still sized
// off personHeightFor even though stages 3-5 now draw plain dots (person
// glyphs are stage-2-only, see dotTarget's `person` doc comment) — keeping
// the ring's own spacing stable rather than shrinking it around the mark
// that happens to be drawn there today.
const RING_GAP = personHeightFor(6) + 8;

function orbitRings(n: number): OrbitRing[] {
  const single = Math.max(20, (n * SEAT_SPACING) / (2 * Math.PI));
  if (single <= 46) return [{ r: single, count: n, rate: 1 }];
  const inner = Math.max(3, Math.round(n * 0.35));
  const rIn = Math.max(20, (inner * SEAT_SPACING) / (2 * Math.PI));
  return [
    { r: rIn, count: inner, rate: 1.4 },
    { r: rIn + RING_GAP, count: n - inner, rate: 1 },
  ];
}

export interface Cluster {
  n: number;
  rings: OrbitRing[];
  rc: number;
  ang: number;
  x: number;
  y: number;
  date: string;
  // Only consumed by orbitPosition's "pulse" mode — a whole cluster's dots
  // breathe together (see orbitPosition), so the phase/period that drives
  // that breathing lives once per cluster, not per dot. Assigned per cluster
  // (not a single shared constant) so the 14 conversations don't all pulse
  // in lockstep, which read as an artificial metronome rather than organic
  // motion when first tried.
  pulsePhase: number;
  pulsePeriod: number;
}

export interface FunnelDot {
  cloud: { x: number; y: number; ax: number; ay: number; fx: number; fy: number; px: number; py: number };
  fall: [number, number];
  neck: [number, number];
  gather: [number, number];
  kept: boolean;
  /** True for every kept dot plus a proportional draw of dropped dots per
   * region, sized to that region's invited quota (funnel.ts's
   * invitedByRegion) — always a superset of kept, since every real
   * attendee was necessarily invited. Only the "Selected"/stage-2 pane
   * (via dotTarget's stage2Tier) ever reads this; every other stage still
   * keys off `kept`. */
  invited: boolean;
  region: string;
  fieldOfWork: string;
  group: number; // cluster index, -1 if not kept
  orbit: { r: number; rate: number; a0: number } | null;
}

export interface FunnelCloudLayout {
  dots: FunnelDot[];
  clusters: Cluster[];
  ringRadius: number;
  phase1Total: number;
  keptTotal: number;
  invitedTotal: number;
}

/** Deterministic given the same FunnelData — same seed the reference sketch
 * pins its own mulberry32 to, so the cloud's shape doesn't reshuffle on
 * every reload. */
const SEED = 20250825;

export function buildFunnelCloud(data: FunnelData): FunnelCloudLayout {
  const rand = mulberry32(SEED);

  const attendCountByRegion = new Map(data.regions.map((r) => [r.name, r.attendCount]));
  const attendCountByFieldOfWork = new Map(data.fieldOfWork.map((f) => [f.name, f.attendCount]));

  const droppedRegionCounts = data.regions.map((r) => ({ name: r.name, count: r.surveyCount - r.attendCount }));
  const droppedFieldOfWorkCounts = data.fieldOfWork.map((f) => ({ name: f.name, count: f.surveyCount - f.attendCount }));

  const keptTotal = data.sessions.reduce((sum, s) => sum + s.attendees.length, 0);
  const droppedTotal = data.phase1Total - keptTotal;

  const droppedRegions = proportionalDraw(droppedRegionCounts, rand);
  const droppedFieldOfWork = proportionalDraw(droppedFieldOfWorkCounts, rand);

  // Blobs, cloud jitter, and fall targets are assigned to every dot
  // uniformly — a dot's category never affects where it sits in the crowd,
  // only what color it takes.
  const blobs = buildBlobs(rand);
  const dots: FunnelDot[] = [];
  for (let i = 0; i < data.phase1Total; i++) {
    const b = blobs[i % BLOBS];
    const bx = clamp(b.x + gauss(rand) * b.sx, 70, CANVAS.W - 70);
    const by = clamp(b.y + gauss(rand) * b.sy, 152, 432);
    dots.push({
      cloud: {
        x: bx,
        y: by,
        ax: 7 + rand() * 15,
        ay: 5 + rand() * 11,
        fx: 0.25 + rand() * 0.55,
        fy: 0.2 + rand() * 0.5,
        px: rand() * Math.PI * 2,
        py: rand() * Math.PI * 2,
      },
      fall: [bx + gauss(rand) * 60, CANVAS.H + 70 + rand() * 180],
      neck: [CX + gauss(rand) * 16, NECK_Y],
      gather: [0, 0],
      kept: false,
      invited: false,
      region: "",
      fieldOfWork: "",
      group: -1,
      orbit: null,
    });
  }

  // Assign the dropped dots' categories first (independent draws), then
  // overwrite the leftover slots with real attendees below.
  let droppedCursor = 0;
  const keptIndices = shuffle(
    Array.from({ length: data.phase1Total }, (_, i) => i),
    rand,
  ).slice(0, keptTotal);
  const keptSet = new Set(keptIndices);
  for (let i = 0; i < data.phase1Total; i++) {
    if (keptSet.has(i)) continue;
    dots[i].region = droppedRegions[droppedCursor];
    dots[i].fieldOfWork = droppedFieldOfWork[droppedCursor];
    droppedCursor++;
  }

  // Sessions come pre-sorted chronologically (funnel.ts); that order becomes
  // ring position, earliest at the top, clockwise.
  const clusters: Cluster[] = data.sessions.map((s, g) => {
    const rings = orbitRings(s.attendees.length);
    return {
      n: s.attendees.length,
      rings,
      rc: Math.max(...rings.map((r) => r.r)) + 7,
      ang: -Math.PI / 2 + g * ((Math.PI * 2) / data.sessions.length),
      x: 0,
      y: 0,
      date: s.date,
      pulsePhase: rand() * Math.PI * 2,
      pulsePeriod: PULSE_PERIOD_BASE * (1 - PULSE_PERIOD_JITTER / 2 + rand() * PULSE_PERIOD_JITTER),
    };
  });
  const maxRc = Math.max(...clusters.map((c) => c.rc));
  const ringRadius = Math.min(214, Math.max(150, (data.sessions.length * (2 * maxRc + 24)) / (2 * Math.PI)));
  for (const cl of clusters) {
    cl.x = CX + Math.cos(cl.ang) * ringRadius;
    cl.y = CY + Math.sin(cl.ang) * ringRadius;
  }

  // Seat every real attendee: claim one kept dot per attendee, in shuffled
  // kept-index order, and give it that attendee's real category pair plus
  // its real orbit seat.
  let keptCursor = 0;
  const flatKeptOrder: number[] = [];
  data.sessions.forEach((s, g) => {
    const rings = clusters[g].rings;
    let seatCursor = 0;
    for (const ring of rings) {
      for (let k = 0; k < ring.count; k++, seatCursor++) {
        const idx = keptIndices[keptCursor++];
        const attendee = s.attendees[seatCursor];
        dots[idx].kept = true;
        dots[idx].region = attendee.region;
        dots[idx].fieldOfWork = attendee.fieldOfWork;
        dots[idx].group = g;
        dots[idx].orbit = { r: ring.r, rate: ring.rate, a0: clusters[g].ang + Math.PI + (seatCursor / ring.count) * Math.PI * 2 };
        flatKeptOrder.push(idx);
      }
    }
  });

  // Hand out phase 2 gather positions in ring order (grouped by which
  // cluster a dot lands in), so the funnel bloom fans out cleanly even
  // though membership is fixed by real data — same "seat by angle" trick as
  // the reference sketch. The 1.8 multiplier was tuned for the plain
  // DOT_SIZE-era dot; a stage-2 person glyph (personHeightFor(7)) is taller
  // than the dot's own packing pitch at that density, so it's 2.5 now —
  // funnelCloud.test.ts's gather overlap invariant is what this is tuned
  // against, not a general formula, so re-run it before changing either
  // number. Plenty of room here (unlike the orbit rings): the gather blob
  // sits alone in open canvas, nothing else it can grow into.
  const gatherPositions = packed(keptTotal, CX, GATHER_Y, 7 * Math.sqrt(keptTotal) * 2.5);
  const seatsByAngle = gatherPositions
    .map((p) => {
      let a = Math.atan2(p[1] - GATHER_Y, p[0] - CX) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      return { p, a };
    })
    .sort((u, v) => u.a - v.a);
  flatKeptOrder.forEach((idx, k) => {
    dots[idx].gather = seatsByAngle[k].p;
  });

  // Every kept dot was necessarily invited; extend "invited" to a
  // proportional draw of dropped dots per region, sized to that region's
  // invited quota (funnel.ts's invitedByRegion, already floored at its real
  // attendCount) minus the attendees already counted via `kept`. Must run
  // last, after every earlier draw that consumes `rand` — otherwise the
  // cloud's deterministic shape (see the SEED comment above) reshuffles.
  const invitedQuotaByRegion = new Map(data.invitedByRegion.map((r) => [r.name, r.count]));
  const droppedIndicesByRegion = new Map<string, number[]>();
  dots.forEach((dot, i) => {
    if (dot.kept) {
      dot.invited = true;
      return;
    }
    const list = droppedIndicesByRegion.get(dot.region);
    if (list) list.push(i);
    else droppedIndicesByRegion.set(dot.region, [i]);
  });
  for (const [region, indices] of droppedIndicesByRegion) {
    const extra = Math.max(0, (invitedQuotaByRegion.get(region) ?? 0) - (attendCountByRegion.get(region) ?? 0));
    for (const idx of shuffle(indices, rand).slice(0, extra)) dots[idx].invited = true;
  }

  return { dots, clusters, ringRadius, phase1Total: data.phase1Total, keptTotal, invitedTotal: data.invitedTotal };
}

export interface DotTarget {
  x: number;
  y: number;
  viaX?: number;
  viaY?: number;
  r: number;
  alpha: number;
  categoryKey: string;
  /** True only at stage 3 ("Phase 2"), for kept dots — the one moment the
   * gathered cohort reads as identifiable individuals rather than a
   * statistical population. The component reads this to stamp a person
   * glyph in place of the plain dot (see ParticipantFunnelCloud.svelte's
   * draw loop and personGlyph.ts). False again at every later stage — the
   * conversation ring, curtain, and moments stages all draw plain dots, so
   * the person figure stays a single deliberate beat rather than a
   * persistent state. Always false for dropped dots, at every stage: they
   * never become individuals, just fade to alpha 0. */
  person: boolean;
}

function cloudPosition(dot: FunnelDot, clock: number, driftSpeed: number): [number, number] {
  return [
    dot.cloud.x + Math.sin(clock * dot.cloud.fx * driftSpeed * 3 + dot.cloud.px) * dot.cloud.ax,
    dot.cloud.y + Math.cos(clock * dot.cloud.fy * driftSpeed * 3 + dot.cloud.py) * dot.cloud.ay,
  ];
}

/** "orbit" (default) is today's steady rotation. "pulse" is the biomimicry-
 * inspired alternative: the same seats rotate at only PULSE_ROTATE_FRACTION
 * of that speed while their distance from the cluster center breathes in
 * and out by +/-PULSE_AMPLITUDE, in sync across every dot in the cluster
 * (driven by the cluster's own pulsePhase/pulsePeriod, not the individual
 * dot) — so a whole conversation reads as one slowly breathing body rather
 * than a spinning ring. */
export function orbitPosition(dot: FunnelDot, cluster: Cluster, clock: number, orbitSpeed: number, mode: MotionMode = "orbit"): [number, number] {
  if (!dot.orbit) return [cluster.x, cluster.y];
  if (mode === "pulse") {
    const a = dot.orbit.a0 + clock * orbitSpeed * dot.orbit.rate * PULSE_ROTATE_FRACTION;
    const breathe = 1 + PULSE_AMPLITUDE * Math.sin((clock / cluster.pulsePeriod) * Math.PI * 2 + cluster.pulsePhase);
    const r = dot.orbit.r * breathe;
    return [cluster.x + Math.cos(a) * r, cluster.y + Math.sin(a) * r];
  }
  const a = dot.orbit.a0 + clock * orbitSpeed * dot.orbit.rate;
  return [cluster.x + Math.cos(a) * dot.orbit.r, cluster.y + Math.sin(a) * dot.orbit.r];
}

/** Same per-stage target logic as the reference sketch's target(), just
 * parameterized on which dimension currently drives color (categoryKey) and
 * taking `clusters` directly instead of closing over a module-level array,
 * so this stays a pure function of its arguments. */
export function dotTarget(
  dot: FunnelDot,
  stage: number,
  dimension: FunnelDimension,
  clusters: Cluster[],
  clock: number,
  driftSpeed: number,
  orbitSpeed: number,
  motionMode: MotionMode = "orbit",
  // Which set of dots the "Selected" stage lights at full opacity — defaults
  // to "attended" (dot.kept) so ParticipantFunnelCloud.svelte and
  // ParticipantFunnelCloudConcepts.svelte, whose stage-2 pane is captioned
  // "continues to phase 2" with count: keptTotal, keep drawing exactly the
  // 103 kept dots. Only ParticipantFunnelSelection.svelte passes "invited",
  // for its own differently-captioned pane — same lib stage, different
  // story, so the split lives here rather than as a second stage index.
  stage2Tier: "attended" | "invited" = "attended",
): DotTarget {
  const category = dot[dimension];
  const [cloudX, cloudY] = cloudPosition(dot, clock, driftSpeed);

  // Stage 1 ("Phase 1 concepts") is a new stage inserted between Phase 1 and
  // Selected — its "dots" toggle mode is a continuation of the same drifting
  // cloud, not a new visual, so it shares stage 0's case exactly.
  if (stage === 0 || stage === 1) return { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 0.62, categoryKey: category, person: false };
  if (stage === 2) {
    const bright = stage2Tier === "invited" ? dot.invited : dot.kept;
    return bright
      ? { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 1, categoryKey: category, person: false }
      : { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 0.1, categoryKey: "__dropped", person: false };
  }
  if (stage === 3) {
    return dot.kept
      ? { x: dot.gather[0], y: dot.gather[1], viaX: dot.neck[0], viaY: dot.neck[1], r: 7, alpha: 1, categoryKey: category, person: true }
      : { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
  }
  if (stage === 4) {
    if (!dot.kept || dot.group < 0) return { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
    const [ox, oy] = orbitPosition(dot, clusters[dot.group], clock, orbitSpeed, motionMode);
    return { x: ox, y: oy, r: 6, alpha: 1, categoryKey: category, person: false };
  }
  // stage 5 ("Behind the curtain") and stage 6 ("Deliberative moments") —
  // both the same orbiting ring as stage 4, just shifted left to free up
  // room for whichever right-hand panel that stage shows. The shift lives
  // here (not as a CSS/canvas-transform on the whole draw) so it goes
  // through the same eased transition as every other stage change.
  if (stage === 5 || stage === 6) {
    if (!dot.kept || dot.group < 0) return { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
    const [ox, oy] = orbitPosition(dot, clusters[dot.group], clock, orbitSpeed, motionMode);
    return { x: ox - RING_SHIFT_X, y: oy, r: 6, alpha: 1, categoryKey: category, person: false };
  }
  // Unreachable for any valid stage (0-6) — stage 7 ("Phase 1 -> Phase 2")
  // falls here too, deliberately: it's drawn by its own separate overlay
  // (PhaseDistillationFinale.svelte), so every dot fading to off-canvas
  // alpha 0 is exactly the desired result, not a bug. Kept as a defined
  // fallback rather than a thrown error so any other out-of-range stage
  // degrades the same way instead of crashing the animation loop.
  return { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
}
