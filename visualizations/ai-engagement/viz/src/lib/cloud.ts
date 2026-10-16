/**
 * Pure, DOM-free word-cloud layout for the Phase 1 -> Phase 2 distillation,
 * built directly on distill.ts's DistillGraph — this is a third rendering of
 * the same graph DistillFlow.svelte (alluvial) and DistillTree.svelte
 * (radial) already draw, not a new analysis. Same conventions as those
 * modules: closed-form placement (an Archimedean spiral with rectangle
 * collision, heaviest word first, occasional 90-degree rotation for short
 * labels), no iterative solver, no DOM measurement, fully deterministic
 * given the same graph — see place()'s own comment for how the shape of
 * that search is what turns weight into a round, center-out silhouette.
 *
 * Sizing crosses the same unit boundary distill.ts documents: Phase 1 words
 * are sized by respondent count (DistillNode.raw), Phase 2 words by
 * roomsRank.ts's compositeMetric() (sessions + top ideas) — never by vote
 * share. Using vote share (DistillNode.weight) or a sum of absorbed Phase 1
 * counts would assert exactly what crosswalk.json's own caveat forbids:
 * "no edge implies any respondent endorsed the concept it points to."
 * A Phase 2 word's on-screen growth during the animation is therefore a
 * progress reveal driven by DistillEdge.wTarget, not a measurement.
 *
 * A theme with more than one surviving edge (a "PRIVACY_SURVEILLANCE"-shaped
 * theme — three concepts, one primary strength apiece) is shown once at
 * rest, then peels into one flight per edge, each sized by that edge's
 * wSource share, when the distill starts. Every edge is spent; nothing is
 * silently dropped the way "strongest edge only" would drop it.
 */
import { compositeMetric } from "./roomsRank.ts";
import { assignCategoryColors, DATA_VIZ_NEUTRAL_LIGHT } from "./palette.ts";
import type { DistillGraph } from "./distill.ts";
import type { RoomsData } from "./roomsData.ts";

/** Estimated glyph width as a fraction of font size — same "no DOM
 * measurement in pure code" convention as labels.ts's CHAR_WIDTH_PX, just
 * expressed per-em so it scales across this module's wide range of font
 * sizes (11-45px) instead of being pinned to one size like DistillFlow's
 * fixed 6.2px-at-10px constant. */
export const CHAR_WIDTH_RATIO = 0.6;
/** Exported so DistillCloud.svelte draws each wrapped line at the same
 * spacing this module used to size the word's collision box. */
export const LINE_HEIGHT_EM = 1.32;

// Sized against the real export, not the small unit-test fixtures: at the
// widest filter (scope "all", minStrength "tangential") the source spiral
// holds up to 112 words (64 claimed + 48 unclaimed) and the target spiral
// always holds the full 29 concepts, several with names past 45 characters.
// Font ranges are deliberately modest — this is a cloud of sentence-length
// labels, not single words, so most of each word's footprint is text width,
// not font size.
const SOURCE_FONT_MIN = 9;
const SOURCE_FONT_RANGE = 13;
const TARGET_FONT_MIN = 10;
const TARGET_FONT_RANGE = 15;

/** Fraction of global progress `p` a single flight takes to travel from its
 * source word to its target word. Mirrors the reference prototype's
 * distill-duration constant (sketches/concept-distillation.html's SPAN). */
export const FLIGHT_SPAN = 0.34;
const DELAY_SPAN = 1 - FLIGHT_SPAN;
/** Deterministic stagger between a theme's own peeled flights — no RNG
 * needed since the count per theme is small (max 4 edges in the real
 * crosswalk) and index order is already stable. */
const INTRA_THEME_STAGGER = 0.02;

export interface PlacedWord {
  id: string;
  label: string;
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  color: string;
  /** 90 turns the word onto a vertical baseline — reserved for compact
   * labels the placer couldn't otherwise land in the field's flanks (see
   * `place()`). Optional/defaulting to 0 so the many hand-authored test
   * fixtures that never mention rotation stay valid. */
  rot?: 0 | 90;
}

export interface TargetWord extends PlacedWord {
  /** False for a concept no surviving edge reaches at the current filter —
   * rendered ghosted at full size rather than stuck invisible at zero. */
  reached: boolean;
}

export interface FlightCopy {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  lines: string[];
  /** This flight's share of its source theme's total outgoing weight —
   * distill.ts's DistillEdge.wSource, carried through unchanged. */
  wSource: number;
  /** This flight's share of its target concept's total incoming weight —
   * distill.ts's DistillEdge.wTarget, carried through unchanged. */
  wTarget: number;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  fontSize: number;
  color: string;
  /** Global `p` at which this flight starts moving. */
  delay: number;
  /** Inherited unchanged from the source word — a flight carries the source
   * label's own rotation for its whole trip, never the target word's. */
  rot?: 0 | 90;
}

export interface CloudLayout {
  restWords: PlacedWord[];
  unclaimedWords: PlacedWord[];
  targetWords: TargetWord[];
  flights: FlightCopy[];
}

export interface Point {
  x: number;
  y: number;
}

export interface CloudOpts {
  center?: Point;
  sourceSpread?: number;
  targetSpread?: number;
  bounds?: Bounds;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ONE shared field for both phases, not two side-by-side regions — matching
// the reference prototype (sketches/concept-distillation.html), whose
// `layout(children, ...)` and `layout(parents, ...)` calls share the exact
// same CX/CY and nearly the same spread. A word's flight is however far its
// own destination happens to sit within that one cloud, which is often
// short — that reads as "this space reorganizing," not "things commuting to
// a different neighborhood." Source and target words CAN end up near or
// overlapping each other's positions; that's fine and matches the
// reference's own look, since the two are never both fully opaque there at
// once (see restAlpha/absorbed) — collision only needs to hold within each
// set on its own, not between them.
//
// Sized against the widest real filter's actual footprint (measured, not
// guessed), then shrunk as far as the spiral placer could actually pack it
// without overlap: 112 one-line source words need ~414,000px² of raw box
// area, but a heaviest-first spiral's real packing efficiency depends on
// search budget, not just area headroom — see SOURCE_STEP_BUDGET and
// DENSE_STEP_BUDGET below for the per-pass tries-before-giving-up.
export const CLOUD_WIDTH = 1350;
export const CLOUD_HEIGHT = 1170;
// minY leaves room for the header/counters DistillCloud.svelte draws above
// the cloud (title, subtitle, raised/consolidated counts).
const DEFAULT_CENTER: Point = { x: 675, y: 670 };
const DEFAULT_BOUNDS: Bounds = { minX: 20, maxX: 1330, minY: 190, maxY: 1150 };

/**
 * Maximum px width a single-line word may take. Every label in this cloud
 * renders as ONE line now, no wrapping at all (an earlier version wrapped
 * long labels to two balanced lines; this replaces that). Without a cap,
 * the longest Phase 2 concept names (up to 77 characters) would need a box
 * wider than the whole canvas at their weight-derived font size — so long
 * labels shrink their OWN font size to fit within this width instead of
 * wrapping or running off-canvas. That's a deliberate, visible trade-off:
 * label length can now outrank statistical weight in deciding how big a
 * word actually renders, in exchange for a cloud that's genuinely all
 * single lines rather than an ellipsis or a wrap in disguise.
 */
export const MAX_LINE_WIDTH_PX = 550;

/**
 * Shrinks `fontSize` down, if needed, so `label` rendered at that size and
 * CHAR_WIDTH_RATIO never exceeds MAX_LINE_WIDTH_PX. Never truncates —
 * the whole label always survives, just smaller.
 */
export function capFontSizeForWidth(label: string, fontSize: number): number {
  const naturalWidth = label.length * fontSize * CHAR_WIDTH_RATIO + 8;
  if (naturalWidth <= MAX_LINE_WIDTH_PX) return fontSize;
  return (MAX_LINE_WIDTH_PX - 8) / (label.length * CHAR_WIDTH_RATIO);
}

function fontSizeFor(raw: number, maxRaw: number, min: number, range: number): number {
  return min + range * Math.sqrt(maxRaw > 0 ? raw / maxRaw : 0);
}

function linesFor(label: string, _fontSize: number): string[] {
  return [label];
}

/** A word's footprint at a given rotation, before centering — the one place
 * that knows a 90-degree turn swaps which axis text length occupies. Shared
 * by `wordBox` (visual extent, margin 0) and `place()`'s own collision math
 * (inflated by margin), so the two can never independently drift apart. */
export function boxSize(lines: string[], fontSize: number, rot: 0 | 90 = 0, margin = 0): { w: number; h: number } {
  const rawW = Math.max(...lines.map((l) => l.length)) * fontSize * CHAR_WIDTH_RATIO + 8;
  const rawH = lines.length * fontSize * LINE_HEIGHT_EM;
  const w = rot === 90 ? rawH : rawW;
  const h = rot === 90 ? rawW : rawH;
  return { w: w + margin, h: h + margin };
}

/** The axis-aligned box a word's lines occupy, centered on (x, y) — the one
 * source of truth for both collision placement and overlap tests, so a test
 * can never disagree with what actually got placed. */
export function wordBox(word: { x: number; y: number; fontSize: number; lines: string[]; rot?: 0 | 90 }): { x0: number; y0: number; x1: number; y1: number } {
  const { w, h } = boxSize(word.lines, word.fontSize, word.rot ?? 0);
  return { x0: word.x - w / 2, y0: word.y - h / 2, x1: word.x + w / 2, y1: word.y + h / 2 };
}

interface PlaceItem {
  id: string;
  fontSize: number;
  lines: string[];
  /** The statistical measure this item is actually sized by (respondent
   * count for Phase 1, compositeMetric for Phase 2) — placement order runs
   * on this, NOT on `fontSize`. A long label's rendered fontSize can be
   * pulled down well below what its weight would otherwise earn it (see
   * `capFontSizeForWidth`), and sorting by the shrunk font size would send
   * a heavy-but-long word out to the field's edge — backwards from the
   * center-out, heaviest-first silhouette a word cloud reads as. */
  weight: number;
  /** Subtheme id — items sharing a groupKey are the same color, and the
   * placer tries to keep them well apart from each other, not just clear
   * of overlap. Undefined for gray (unclaimed/no-subtheme) items, which
   * aren't part of the color story this rule protects. */
  groupKey?: string;
}

/**
 * Minimum gap, in canvas px, kept clear between any two placed words' visual
 * boxes, regardless of color. Without this, the collision check only ruled
 * out literal overlap — neighbors could still land pixel-adjacent, reading
 * as one continuous block of text instead of two distinct ideas. Kept
 * small on purpose — enough to read as two words, not enough to leave
 * visible dead space between them (a word cloud reads as a cloud when
 * words nestle close, not when they float apart).
 */
const PLACEMENT_MARGIN = 6;

/**
 * Extra clearance required between two SAME-groupKey items, on top of
 * PLACEMENT_MARGIN — same motivation as PLACEMENT_MARGIN, sharper case:
 * two same-colored words sitting merely a little apart (not touching, just
 * near) still read as "these are the same idea," which is exactly backwards
 * when they're two different concepts that happen to share a subtheme
 * (confirmed against a real screenshot — "Protect the environment and
 * consumers from the resource needs of data centers" next to "Hold AI
 * companies accountable for protecting consumers", both genuinely ST-07,
 * so the shared color is correct, but their proximity read as one idea).
 * Applied as a second, same-group-only check with its own inflated box.
 *
 * Split by axis rather than one isotropic margin: two same-colored labels
 * stacked vertically (adjacent lines) read as a paragraph far more readily
 * than two sitting side by side, so the vertical margin stays wide while the
 * horizontal one is much smaller — a big lever for letting a subtheme's
 * members nestle into a round silhouette instead of forcing them into a
 * loose vertical column. Both margins are also scaled down for large
 * groups (ST-01 has 6 concepts, ST-06 has 5 at the real filter): demanding
 * the full margin between every pair in a 6-member group can tear a hole in
 * the cloud that "just don't overlap" (the same-groupSpacing relaxation
 * below) would otherwise have to paper over entirely.
 */
const SAME_GROUP_MARGIN_Y = 28;
const SAME_GROUP_MARGIN_X = 10;
/** A group of 3 or fewer keeps full margin; bigger groups scale it down,
 * floored so members of even the largest real group (6) still keep some
 * daylight. */
function groupMarginScale(groupCount: number): number {
  return clamp(3 / groupCount, 0.45, 1);
}

/**
 * How aggressively a spiral's radius grows per unit of angle — smaller
 * means the spiral coils tighter near the center before venturing out,
 * testing far more candidate positions per unit of radius. The source
 * pass (up to 112 words) needs the faster/coarser default just to reach
 * the whole canvas within its step budget; the target pass (always 29
 * concepts) uses a slower growth instead, specifically so a small item
 * count clusters into a dense, roughly circular mass — a real "word cloud"
 * silhouette — rather than fanning out thinly across whatever room happens
 * to be free on the shared canvas.
 *
 * Both values sit lower than they once needed to: golden-angle phasing (see
 * GOLDEN_ANGLE below), bounds-clamping instead of bounds-rejecting, and
 * weight-order-first placement all now do real work toward a round,
 * even-density field, so growth no longer has to compensate for a
 * center-biased search on its own.
 */
const DEFAULT_RADIAL_GROWTH = 1.2;
const DENSE_RADIAL_GROWTH = 2.0;
/** Finer angle step for the target pass — its slower growth needs more
 * angular resolution to actually find the tighter gaps between the 29
 * concepts, not just more radius to sweep through. */
const DENSE_ANGLE_STEP = 0.02;
/** Slower growth means the spiral needs more steps to reach a given
 * radius, so the target pass gets a bigger step budget too — cheap, since
 * it's only ever 29 items. */
const DENSE_STEP_BUDGET = 60000;
/** Raised alongside DEFAULT_RADIAL_GROWTH's reduction, for the same reason
 * DENSE_STEP_BUDGET is generous relative to its own growth rate: a slower
 * spiral needs more steps to reach the same radius. */
const SOURCE_STEP_BUDGET = 30000;

/** Successive angles, in radians, this many units apart tile a circle with
 * no two ever landing on the same ray — the same constant behind sunflower-
 * seed and phyllotactic spirals. Used to give every item in the placement
 * order its own fixed starting angle (see `place()`), so shells fill evenly
 * around the full circle instead of every item's search scanning outward
 * from due east first, which is what produced the old triangular, center-
 * heavy field: identical starting angle per item meant identical shells,
 * biased toward whichever direction the search tries first. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Only labels this short (px, at their own full rendered fontSize) are
 * ever considered for a 90-degree turn — the lever that lets one-line
 * labels reach a field's left/right flanks (see MAX_LINE_WIDTH_PX's own
 * comment on why wrapping isn't an option here). A multi-word sentence
 * turned vertical is unreadable, so this is deliberately tight — it only
 * ever fires for genuinely short labels, not typical Phase 2 concept
 * names. */
const ROTATE_MAX_TEXT_PX = 220;
/** Deterministic instead of random: every Nth eligible item (by placement
 * order) is offered rotation as an option, so which items rotate never
 * varies between runs — same "no RNG anywhere in this module" contract as
 * the rest of the placer. */
const ROTATE_EVERY = 3;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface Placement extends Point {
  rot: 0 | 90;
}

/**
 * Archimedean-spiral placement with rectangle collision, heaviest word
 * first, shrink-and-retry rather than give up — the same approach proven in
 * the reference prototype (sketches/concept-distillation.html's `layout()`),
 * adapted to return positions instead of mutating canvas-bound items. Fully
 * deterministic: the walk itself has no randomness (GOLDEN_ANGLE phasing is
 * a fixed constant, not a seed), and JS's stable sort keeps ties in the
 * caller's own (already-deterministic) input order.
 *
 * Order is by statistical weight, not by rendered fontSize — see PlaceItem's
 * own comment on why those two can disagree for a long label. Placing
 * heaviest-first is what actually produces a classic word-cloud silhouette
 * (heavy near the center, light toward the edge): the search itself doesn't
 * prefer the center, so the gradient has to come from search order.
 *
 * The field is an ellipse whose aspect matches `bounds`, not a fixed ratio —
 * an iso-radius shell then meets its available room at roughly the same
 * angle all the way around, rather than running out of width long before it
 * runs out of height (or vice versa). Each item gets its own fixed starting
 * angle (GOLDEN_ANGLE apart, in placement order) so successive shells fill
 * the full circle evenly instead of every item's search scanning outward
 * from the same due-east ray first.
 *
 * A word that would still overflow `bounds` at its current angle is clamped
 * to the nearest legal position inside them, not skipped — skipping is what
 * used to turn "ran out of horizontal room" into vertical chimneys above
 * and below the center mass instead of a field that settles flush against
 * its own flanks.
 *
 * Same-group spacing is attempted first and relaxed only if unsatisfiable —
 * a subtheme with many members (up to 18 at the widest filter) sharing one
 * canvas with everything else can genuinely run out of room to keep every
 * pairwise same-group gap this wide; falling back to "just don't overlap
 * anyone" for the few items that need it beats collapsing them all to the
 * canvas center, which the plain distance-exhausted fallback would do.
 *
 * Every Nth compact-enough label is turned 90 degrees before its own search
 * even starts (see ROTATE_MAX_TEXT_PX/ROTATE_EVERY below and this
 * function's own rotation-assignment comment for why that has to be
 * decided up front rather than discovered during placement). A vertical
 * tick can then nest into a gap beside a wide horizontal neighbor that no
 * horizontal-only label could ever fit into.
 */
function place(
  items: PlaceItem[],
  center: Point,
  spread: number,
  bounds: Bounds,
  radialGrowth = DEFAULT_RADIAL_GROWTH,
  stepBudget = 20000,
  angleStep = 0.03,
): Map<string, Placement> {
  const placed: { x0: number; y0: number; x1: number; y1: number; groupKey?: string }[] = [];
  const positions = new Map<string, Placement>();
  const order = [...items].sort((a, b) => b.weight - a.weight || b.fontSize - a.fontSize);

  const groupCounts = new Map<string, number>();
  for (const it of items) if (it.groupKey) groupCounts.set(it.groupKey, (groupCounts.get(it.groupKey) ?? 0) + 1);

  const availW = bounds.maxX - bounds.minX;
  const availH = bounds.maxY - bounds.minY;
  const aspect = clamp(availW / availH, 1.15, 1.6);
  const ax = spread;
  const ay = spread / aspect;

  function findSpot(
    item: PlaceItem,
    phase: number,
    rot: 0 | 90,
    enforceGroupSpacing: boolean,
  ): { pos: Point; box: { x0: number; y0: number; x1: number; y1: number } } | null {
    for (const shrink of [1, 0.85, 0.7]) {
      const fontSize = item.fontSize * shrink;
      const lines = shrink === 1 ? item.lines : linesFor(item.lines.join(" "), fontSize);
      const { w, h } = boxSize(lines, fontSize, rot, PLACEMENT_MARGIN);
      if (w > availW || h > availH) continue; // fits nowhere at this size in this orientation
      const halfW = w / 2;
      const halfH = h / 2;

      for (let step = 0; step < stepBudget; step++) {
        const t = step * angleStep;
        const r = radialGrowth * t;
        const a = t + phase;
        const rawX = center.x + Math.cos(a) * r * ax;
        const rawY = center.y + Math.sin(a) * r * ay;
        const x = clamp(rawX, bounds.minX + halfW, bounds.maxX - halfW);
        const y = clamp(rawY, bounds.minY + halfH, bounds.maxY - halfH);
        const x0 = x - halfW;
        const y0 = y - halfH;
        const x1 = x + halfW;
        const y1 = y + halfH;

        if (placed.some((q) => x0 < q.x1 && x1 > q.x0 && y0 < q.y1 && y1 > q.y0)) continue;
        if (enforceGroupSpacing && item.groupKey) {
          const scale = groupMarginScale(groupCounts.get(item.groupKey) ?? 1);
          const mX = SAME_GROUP_MARGIN_X * scale;
          const mY = SAME_GROUP_MARGIN_Y * scale;
          const tooCloseToSameGroup = placed.some(
            (q) => q.groupKey === item.groupKey && x0 - mX < q.x1 && x1 + mX > q.x0 && y0 - mY < q.y1 && y1 + mY > q.y0,
          );
          if (tooCloseToSameGroup) continue;
        }
        return { pos: { x, y }, box: { x0, y0, x1, y1 } };
      }
    }
    return null;
  }

  // Rotation is decided up front, per item, not by trial-and-error during
  // placement — same convention as d3-cloud's own rotate() accessor: fixing
  // the angle before layout, rather than treating it as a collision
  // fallback. A fallback design was tried first and didn't work: with
  // bounds-clamping (see above) a word's default horizontal search almost
  // never truly runs out of room, so a "prefer 0, fall back to 90" rule
  // left rotation dead code in practice — confirmed against the real
  // export, which placed zero rotated words under that design.
  let eligibleSeen = 0;
  order.forEach((item, i) => {
    const phase = (i * GOLDEN_ANGLE) % (2 * Math.PI);
    const naturalWidth = Math.max(...item.lines.map((l) => l.length)) * item.fontSize * CHAR_WIDTH_RATIO;
    const eligible = naturalWidth <= ROTATE_MAX_TEXT_PX;
    // "Every Nth eligible word," not every Nth word overall — counted
    // against its own (usually small) subset so the cadence stays
    // meaningful even when most labels in a filter are too long to
    // qualify at all (true of the real Phase 2 concept names).
    const rot: 0 | 90 = eligible && eligibleSeen++ % ROTATE_EVERY === 0 ? 90 : 0;
    const found = findSpot(item, phase, rot, true) ?? findSpot(item, phase, rot, false);
    positions.set(item.id, found ? { x: found.pos.x, y: found.pos.y, rot } : { x: center.x, y: center.y, rot: 0 });
    if (found) placed.push({ ...found.box, groupKey: item.groupKey });
  });
  return positions;
}

/** Previously forced ST-07 ("Protecting people and the planet from the
 * effects of AI") off DATA_VIZ_CAT's index 6, which under the old 9-hue
 * ramp (#3d6a7f, a desaturated blue-teal) read as indistinguishable from
 * ST-01's index-0 blue (#0d4f8c) once both were shrunk down to word-cloud
 * text — flagged directly against the rendered legend. The EC design
 * system's own "Data Viz" ramp (palette.ts's current DATA_VIZ_CAT) puts a
 * blue at index 0 (#65ade1) and a purple at index 6 (#6d4884) instead, which
 * don't share that collision, so no override is needed against it. Left as
 * an empty, id-keyed map (rather than deleted outright) since
 * subthemePalette below is exactly the right place to add a new one-off fix
 * here — not a palette.ts change — if this app's own 8-subtheme assignment
 * ever turns up a fresh collision against a future palette revision. */
const SUBTHEME_COLOR_OVERRIDES: Record<string, string> = {};

/**
 * The one color-per-subtheme mapping used everywhere in this view — by
 * buildCloud() for every word/flight, and by DistillCloud.svelte for its
 * legend. Kept as a single exported function specifically so those two
 * call sites can never independently drift out of sync with each other.
 */
export function subthemePalette(subthemeIds: string[]): string[] {
  const base = assignCategoryColors(subthemeIds);
  return subthemeIds.map((id, i) => SUBTHEME_COLOR_OVERRIDES[id] ?? base[i]);
}

/**
 * Builds the full cloud layout for one filtered DistillGraph: Phase 1 words
 * (claimed themes + unclaimed, one shared spiral so the "how much of Phase 1
 * carried forward" story reads in one glance), the flights each claimed
 * theme peels into, and Phase 2 target words sized by compositeMetric.
 */
export function buildCloud(graph: DistillGraph, rooms: RoomsData, opts: CloudOpts = {}): CloudLayout {
  const center = opts.center ?? DEFAULT_CENTER;
  const sourceSpread = opts.sourceSpread ?? 1.35;
  const targetSpread = opts.targetSpread ?? 1.3;
  const bounds = opts.bounds ?? DEFAULT_BOUNDS;

  // --- colors: concepts tint by subtheme (8 of them, fits DATA_VIZ_CAT's 9
  // primary hues with no lighter-ramp fallback needed); a flight inherits
  // its OWN destination's color (so a theme's fragments can visibly diverge
  // in color as they split toward differently-grouped concepts) ---
  const subthemeIds = rooms.subthemes.map((s) => s.id);
  const subthemeColors = subthemePalette(subthemeIds);
  const subthemeColorOf = new Map(subthemeIds.map((id, i) => [id, subthemeColors[i]]));
  const conceptSubthemeOf = new Map(rooms.concepts.map((c) => [c.id, c.subthemeId]));
  const colorForConcept = (conceptId: string): string => subthemeColorOf.get(conceptSubthemeOf.get(conceptId) ?? "") ?? DATA_VIZ_NEUTRAL_LIGHT;

  // --- Phase 1: claimed + unclaimed themes share one spiral and one size
  // scale, so a viewer reads "all of Phase 1" as a single cloud where the
  // gray words are the ones that didn't carry forward ---
  const claimed = graph.themeNodes;
  const unclaimed = graph.unclaimed;
  const maxThemeRaw = Math.max(1, ...claimed.map((t) => t.raw), ...unclaimed.map((t) => t.raw));

  // Each claimed theme's dominant edge decides its at-rest color (before it
  // has anywhere to diverge to) — and, via that edge's target concept's
  // subtheme, its groupKey for the same-color-keeps-its-distance placement
  // rule below. Ties keep the crosswalk's own edge order. Unclaimed themes
  // get neither: they're gray, not part of any subtheme's color story.
  const edgesByCode = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) {
    const list = edgesByCode.get(e.code) ?? [];
    list.push(e);
    edgesByCode.set(e.code, list);
  }
  function dominantConceptId(code: string): string | undefined {
    const edges = edgesByCode.get(code) ?? [];
    const strongest = edges.reduce((best, e) => (e.wSource > (best?.wSource ?? -1) ? e : best), edges[0]);
    return strongest?.conceptId;
  }
  function dominantColor(code: string): string {
    const conceptId = dominantConceptId(code);
    return conceptId ? colorForConcept(conceptId) : DATA_VIZ_NEUTRAL_LIGHT;
  }

  const sourceItems: PlaceItem[] = [
    ...claimed.map((t) => {
      const fontSize = capFontSizeForWidth(t.label, fontSizeFor(t.raw, maxThemeRaw, SOURCE_FONT_MIN, SOURCE_FONT_RANGE));
      return { id: t.id, fontSize, weight: t.raw, lines: linesFor(t.label, fontSize), groupKey: conceptSubthemeOf.get(dominantConceptId(t.id) ?? "") };
    }),
    ...unclaimed.map((t) => {
      const fontSize = capFontSizeForWidth(t.label, fontSizeFor(t.raw, maxThemeRaw, SOURCE_FONT_MIN, SOURCE_FONT_RANGE));
      return { id: t.id, fontSize, weight: t.raw, lines: linesFor(t.label, fontSize) };
    }),
  ];
  const sourcePositions = place(sourceItems, center, sourceSpread, bounds, DEFAULT_RADIAL_GROWTH, SOURCE_STEP_BUDGET);
  const sourceItemById = new Map(sourceItems.map((it) => [it.id, it]));

  const restWords: PlacedWord[] = claimed.map((t) => {
    const item = sourceItemById.get(t.id)!;
    const pos = sourcePositions.get(t.id)!;
    return { id: t.id, label: t.label, lines: item.lines, x: pos.x, y: pos.y, fontSize: item.fontSize, color: dominantColor(t.id), rot: pos.rot };
  });
  const unclaimedWords: PlacedWord[] = unclaimed.map((t) => {
    const item = sourceItemById.get(t.id)!;
    const pos = sourcePositions.get(t.id)!;
    return { id: t.id, label: t.label, lines: item.lines, x: pos.x, y: pos.y, fontSize: item.fontSize, color: DATA_VIZ_NEUTRAL_LIGHT, rot: pos.rot };
  });
  const restWordById = new Map(restWords.map((w) => [w.id, w]));

  // --- Phase 2: target words sized by compositeMetric (sessions + top
  // ideas), never by vote share or by summed Phase 1 counts — see module
  // header ---
  const reachedIds = new Set(graph.edges.map((e) => e.conceptId));
  const composites = new Map(rooms.concepts.map((c) => [c.id, compositeMetric(c) ?? 0]));
  const maxComposite = Math.max(1, ...composites.values());

  const targetItems: PlaceItem[] = rooms.concepts.map((c) => {
    const fontSize = capFontSizeForWidth(c.name, fontSizeFor(composites.get(c.id) ?? 0, maxComposite, TARGET_FONT_MIN, TARGET_FONT_RANGE));
    return { id: c.id, fontSize, weight: composites.get(c.id) ?? 0, lines: linesFor(c.name, fontSize), groupKey: c.subthemeId };
  });
  const targetPositions = place(targetItems, center, targetSpread, bounds, DENSE_RADIAL_GROWTH, DENSE_STEP_BUDGET, DENSE_ANGLE_STEP);
  const targetItemById = new Map(targetItems.map((it) => [it.id, it]));

  const targetWords: TargetWord[] = rooms.concepts.map((c) => {
    const item = targetItemById.get(c.id)!;
    const pos = targetPositions.get(c.id)!;
    return {
      id: c.id,
      label: c.name,
      lines: item.lines,
      x: pos.x,
      y: pos.y,
      fontSize: item.fontSize,
      color: colorForConcept(c.id),
      reached: reachedIds.has(c.id),
      rot: pos.rot,
    };
  });
  const targetWordById = new Map(targetWords.map((w) => [w.id, w]));

  // --- Flights: one per surviving edge, staggered by its source theme's
  // position in the already crossing-minimized theme order, with a small
  // fixed offset between a theme's own peeled copies ---
  const themeDelay = new Map(claimed.map((t, i) => [t.id, (i / Math.max(claimed.length, 1)) * DELAY_SPAN]));
  const edgeIndexInTheme = new Map<string, number>();
  const flights: FlightCopy[] = graph.edges.map((e) => {
    const idx = edgeIndexInTheme.get(e.code) ?? 0;
    edgeIndexInTheme.set(e.code, idx + 1);
    const delay = Math.min((themeDelay.get(e.code) ?? 0) + idx * INTRA_THEME_STAGGER, DELAY_SPAN);
    const source = restWordById.get(e.code)!;
    const target = targetWordById.get(e.conceptId)!;
    return {
      id: `${e.code}→${e.conceptId}`,
      sourceId: e.code,
      targetId: e.conceptId,
      label: source.label,
      lines: source.lines,
      wSource: e.wSource,
      wTarget: e.wTarget,
      homeX: source.x,
      homeY: source.y,
      targetX: target.x,
      targetY: target.y,
      fontSize: source.fontSize * Math.sqrt(e.wSource),
      color: colorForConcept(e.conceptId),
      delay,
      rot: source.rot,
    };
  });

  return { restWords, unclaimedWords, targetWords, flights };
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 before a flight starts, 1 once FLIGHT_SPAN has elapsed since its delay. */
export function flightProgress(flight: FlightCopy, p: number): number {
  return ease(clamp01((p - flight.delay) / FLIGHT_SPAN));
}

/** A flight's position/size/opacity at a given global progress `p`. Solid
 * for the first 80% of the trip, then dissolves into its target over the
 * last 20% — deliberately holding full opacity much longer than a
 * continuous fade would (an earlier version faded from t=0 onward, so a
 * flight was already fairly dim by the time it arrived; a viewer could
 * watch a concept's size grow without ever registering something visibly
 * flying in first, reading as "appeared from nowhere" even though the
 * data connection is real). Continuous at the t=0.8 seam either way. */
export function flightState(flight: FlightCopy, p: number): { x: number; y: number; fontSize: number; alpha: number } {
  const t = flightProgress(flight, p);
  const FADE_START = 0.8;
  const alpha = t < FADE_START ? 1 : 1 - Math.pow((t - FADE_START) / (1 - FADE_START), 2);
  return {
    x: lerp(flight.homeX, flight.targetX, t),
    y: lerp(flight.homeY, flight.targetY, t),
    fontSize: lerp(flight.fontSize, flight.fontSize * 0.4, t),
    alpha,
  };
}

/** A source word's opacity: fully visible at rest, crossfading to 0 as soon
 * as its OWN flights start moving, so a multi-edge theme reads as "one word
 * that splits" rather than a word sitting frozen under its own copies. */
export function restAlpha(sourceId: string, layout: CloudLayout, p: number): number {
  const own = layout.flights.filter((f) => f.sourceId === sourceId);
  if (own.length === 0) return 1;
  const earliestDelay = Math.min(...own.map((f) => f.delay));
  return 1 - ease(clamp01((p - earliestDelay) / FLIGHT_SPAN));
}

/**
 * An unclaimed theme has no edge, so no flight and no delay to fade
 * against — but it still can't just sit on screen for the whole animation.
 * It dissolves on the same schedule the earliest claimed themes' flights
 * do (delay 0, one FLIGHT_SPAN to fade), so "what didn't carry forward"
 * clears out of the frame together with Phase 1 itself rather than
 * lingering into what's supposed to be the Phase 2 picture.
 */
export function unclaimedAlpha(p: number): number {
  return 1 - ease(clamp01(p / FLIGHT_SPAN));
}

/**
 * A target concept's growth fraction at global progress `p`: the sum, over
 * every edge reaching it, of that edge's wTarget share weighted by its own
 * flight's progress — reaching exactly 1 once every incoming flight has
 * arrived. A concept no edge reaches has no flights to sum, so it reports 1
 * unconditionally: not "will eventually grow" but "ghosted at full size the
 * whole time," which is the honest rendering for a concept the crosswalk
 * never connects to (see distill.ts's `unclaimed` for the Phase 1 mirror of
 * this same idea).
 */
export function absorbed(layout: CloudLayout, targetId: string, p: number): number {
  const incoming = layout.flights.filter((f) => f.targetId === targetId);
  if (incoming.length === 0) return 1;
  return incoming.reduce((sum, f) => sum + f.wTarget * flightProgress(f, p), 0);
}

/** An unreached concept's own display alpha (its size stays fixed at full —
 * see `absorbed` — only its visibility ramps). Fading it in over the same
 * span the earliest flights take, rather than showing it from frame one,
 * matters for more than pacing: at rest it would otherwise sit at a fixed
 * position never checked against the still fully-opaque Phase 1 field
 * sharing that same space (see the module header on why source and target
 * share one field), producing a permanent, real overlap — confirmed against
 * the actual export before this existed. `resolveOverlaps` is the general
 * safety net for the rest of the animation; this is the specific fix for
 * the one word that would otherwise be exempt from ever needing it, since
 * it never had a reason to appear at anything other than "always on."*/
export function ghostAlpha(p: number): number {
  return 0.35 * ease(clamp01(p / FLIGHT_SPAN));
}

export interface RenderCandidate {
  id: string;
  x: number;
  y: number;
  fontSize: number;
  lines: string[];
  color: string;
  label: string;
  alpha: number;
  /** Canvas font weight (400 regular / 600 semibold) — unrelated to
   * PlaceItem's statistical `weight`, which never reaches this interface. */
  weight: 400 | 600;
  rot?: 0 | 90;
}

/**
 * Every word/flight that WOULD be visible at global progress `p`, before
 * occlusion — the full, un-deconflicted picture. Kept as its own function
 * (rather than inlined in DistillCloud.svelte) so "what should be on screen
 * this frame" is pure and testable, same as everything else in this module;
 * the component's only remaining job is to draw whatever
 * `applyOcclusion(frameCandidates(...))` returns.
 */
export function frameCandidates(layout: CloudLayout, p: number): RenderCandidate[] {
  const candidates: RenderCandidate[] = [];
  for (const w of layout.unclaimedWords) candidates.push({ ...w, alpha: unclaimedAlpha(p), weight: 400 });
  for (const w of layout.restWords) candidates.push({ ...w, alpha: restAlpha(w.id, layout, p), weight: 400 });
  for (const f of layout.flights) {
    const s = flightState(f, p);
    candidates.push({ id: f.id, x: s.x, y: s.y, fontSize: s.fontSize, lines: f.lines, color: f.color, label: f.label, alpha: s.alpha, weight: 400, rot: f.rot });
  }
  for (const w of layout.targetWords) {
    if (!w.reached) {
      candidates.push({ ...w, alpha: ghostAlpha(p), weight: 600 });
      continue;
    }
    const growth = absorbed(layout, w.id, p);
    candidates.push({ ...w, fontSize: w.fontSize * growth, alpha: Math.min(growth * 1.6, 1), weight: 600 });
  }
  return candidates;
}

const VISIBILITY_FLOOR = 0.01;

/**
 * The legibility fix, take two. A first version resolved collisions with a
 * hard per-frame accept/reject (most-opaque-first, drop anything whose box
 * touches an already-accepted one) — it did stop two solid labels from ever
 * sitting on top of each other, but "most opaque" is a strict ranking, and
 * exactly at the instant two candidates' alphas cross (which happens
 * continuously, e.g. as a target word grows past a fading source word) the
 * winner of that ranking flips discontinuously — so whichever one just lost
 * the tie would pop off screen (or back on) between frames instead of
 * fading. That's the flashing this replaces; confirmed by reproducing it in
 * a test that samples p every 0.005 and checks no candidate's alpha jumps.
 *
 * This version never ranks anyone. For every overlapping pair, each one's
 * alpha is reduced by "occlusion pressure" from the other — the overlap
 * area, weighted by the OTHER candidate's share of the pair's combined
 * alpha (so a much-brighter neighbor presses harder than a much-fainter
 * one), normalized by the affected candidate's own box area (so a small
 * word losing a given overlap area to a big word is darkened more than the
 * big word losing that same area is). Every term here — overlap area,
 * alpha share, box area — is continuous in position and alpha, and there's
 * no comparison or sort deciding a discrete winner anywhere in the
 * pressure calculation, so the result is continuous too: no ranking to
 * flip, nothing to pop.
 *
 * Trade-off, stated plainly: a still-solid word CAN be dimmed slightly by
 * an overlapping fainter one now (both press on each other, proportional
 * to their alpha share), and a partial overlap leaves both candidates
 * faintly visible in the shared region rather than one disappearing
 * outright. Smoothness costs a little of the previous version's
 * "absolutely never any overlap, ever" — a large, near-total overlap
 * between two comparably solid words still suppresses both toward
 * near-invisible, but a small, transient overlap (a flight sliding past a
 * neighboring word) now fades rather than blinking.
 */
export function applyOcclusion(candidates: RenderCandidate[]): RenderCandidate[] {
  const visible = candidates.filter((c) => c.alpha > VISIBILITY_FLOOR);
  const boxes = visible.map((c) => wordBox(c));
  const areas = boxes.map((b) => Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0)));
  const pressure = new Array(visible.length).fill(0);

  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const [bi, bj] = [boxes[i], boxes[j]];
      const ox = Math.max(0, Math.min(bi.x1, bj.x1) - Math.max(bi.x0, bj.x0));
      const oy = Math.max(0, Math.min(bi.y1, bj.y1) - Math.max(bi.y0, bj.y0));
      const overlapArea = ox * oy;
      if (overlapArea <= 0) continue;
      const [ai, aj] = [visible[i].alpha, visible[j].alpha];
      pressure[i] += (overlapArea * (aj / (ai + aj))) / areas[i];
      pressure[j] += (overlapArea * (ai / (ai + aj))) / areas[j];
    }
  }

  const out: RenderCandidate[] = [];
  for (let i = 0; i < visible.length; i++) {
    const alpha = visible[i].alpha * (1 - Math.min(1, pressure[i]));
    if (alpha > VISIBILITY_FLOOR) out.push({ ...visible[i], alpha });
  }

  // Draw fainter words first so a comparably solid neighbor still reads as
  // "on top" of whatever it's overlapping, even though neither one is
  // strictly the sole occluder anymore.
  return out.sort((a, b) => a.alpha - b.alpha);
}
