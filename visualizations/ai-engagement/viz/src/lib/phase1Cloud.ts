/**
 * Pure, DOM-free layout + timeline math for the placeholder Phase 1 concept
 * cloud (sketches/concept-distillation-real-phase2-themes.html), ported
 * directly from that sketch's own script — same seeded spiral packing, same
 * per-subtheme staggered absorption timeline. Two deliberate deviations
 * from a byte-for-byte port, both required to keep this module pure and
 * unit-testable under this repo's Node test runner (tsx --test), which has
 * no DOM/canvas available:
 *
 *  1. Word wrap uses an estimated character width (CHAR_WIDTH_RATIO), not
 *     real ctx.measureText — same technique cloud.ts and labels.ts already
 *     use elsewhere in this app for the same reason. The visual result is
 *     close to the sketch's, not pixel-identical.
 *  2. Layout runs in its own coordinate space, LAYOUT below — the
 *     reference sketch's own 1100x920 canvas, not this app's smaller
 *     CANVAS (funnelCloud.ts, 1040x812). An earlier version of this module
 *     tried adapting the field bounds down to CANVAS's size instead;
 *     verified empirically that this causes ~12 of 153 items to exhaust
 *     every shrink/retry attempt and stack illegibly on top of each other
 *     at dead-center, while the sketch's own dimensions place all 153 at
 *     their full natural size with zero shrinking needed. phase1CloudDraw.ts
 *     bridges the two spaces with a single ctx.scale() call at draw time,
 *     so the on-screen result still exactly fills the same box as every
 *     other overlay — the only cost is a ~7% non-uniform stretch (1100:920
 *     isn't quite 1040:812's aspect ratio), imperceptible for word-cloud
 *     text at these sizes.
 *
 * Drawing itself lives in phase1CloudDraw.ts, not here — this module only
 * produces the placed words and a pure progress -> accumulation function.
 *
 * PHASE1_CLOUD_LAYOUT below is computed once, at module load, and shared by
 * every consumer — buildPhase1Cloud() itself is expensive (~2.7s, packing
 * 153 items) and deterministic given its fixed default seed, so computing
 * it twice (once per consuming component) would waste ~2.7s of redundant
 * blocking work for an identical result. Call buildPhase1Cloud() directly
 * only where you genuinely need a fresh/different-seed layout (tests).
 */

import { PHASE1_CONCEPTS, type Phase1Concept } from "./phase1ConceptsData.ts";

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same "estimated glyph width as a fraction of font size" technique as
 * cloud.ts's CHAR_WIDTH_RATIO — no DOM measurement available in pure code. */
const CHAR_WIDTH_RATIO = 0.52;
const LINE_HEIGHT_EM = 1.22;

function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

/** Wraps `text` onto at most two lines, splitting at whichever single space
 * best balances the two resulting (estimated) line widths — same algorithm
 * as the sketch's own wrapLabel, against an estimated width instead of
 * ctx.measureText. */
export function wrapTwoLines(text: string, fontSize: number): string[] {
  const words = text.split(" ");
  if (words.length === 1 || estimateWidth(text, fontSize) <= fontSize * 9.5) return [text];

  let best: string[] = [text];
  let bestMax = Infinity;
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const w = Math.max(estimateWidth(line1, fontSize), estimateWidth(line2, fontSize));
    if (w < bestMax) {
      bestMax = w;
      best = [line1, line2];
    }
  }
  return best;
}

function boxSize(lines: string[], fontSize: number): { w: number; h: number } {
  return {
    w: Math.max(...lines.map((l) => estimateWidth(l, fontSize))) + 8,
    h: lines.length * fontSize * LINE_HEIGHT_EM + 5,
  };
}

// This module's own coordinate space — see the header comment above for
// why it's not funnelCloud.ts's CANVAS. Values below match the reference
// sketch exactly (its own TOP/BOTTOM/SIDE field-bound constants).
export const LAYOUT = { W: 1100, H: 920 };

// Field bounds within LAYOUT — FIELD_TOP clears the funnel-cloud's own
// canvas-drawn header (which phase1CloudDraw.ts leaves transparent above
// this line), FIELD_BOTTOM clears this cloud's own subtheme legend
// (phase1CloudDraw.ts's drawLegend).
export const FIELD_TOP = 125;
export const FIELD_BOTTOM = 145;
const FIELD_SIDE = 24;
const CX = LAYOUT.W / 2;
const CY = FIELD_TOP + (LAYOUT.H - FIELD_TOP - FIELD_BOTTOM) / 2;

interface PackItem {
  label: string;
  subtheme: number;
}
interface PlacedSlot {
  home: [number, number];
  lines: string[];
  refFS: number;
}

/** Seeded Archimedean-spiral placement with rectangle collision, heaviest
 * item first — ported from the sketch's own layout(). Same-subtheme items
 * additionally keep a soft buffer from each other (tried first, dropped
 * only if no slot satisfies it), so two ideas from the same subtheme never
 * land edge-to-edge. */
function place<T extends PackItem>(items: T[], sizeFor: (item: T) => number, spread: number, rand: () => number): (T & PlacedSlot)[] {
  const placed: { box: [number, number, number, number]; subtheme: number }[] = [];
  const order = items.map((_, i) => i).sort((a, b) => sizeFor(items[b]) - sizeFor(items[a]));
  const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

  const out: (T & PlacedSlot)[] = items.map((it) => ({ ...it, home: [CX, CY] as [number, number], lines: [it.label], refFS: 10 }));

  for (const i of order) {
    const it = items[i];
    let pos: [number, number] | null = null;
    let fs = 0;
    let lines: string[] = [];

    for (const shrink of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      fs = sizeFor(it) * shrink;
      lines = wrapTwoLines(it.label, fs);
      const { w: boxw, h: boxh } = boxSize(lines, fs);
      const gap = Math.max(14, 0.35 * Math.min(boxw, boxh));

      for (const enforceGap of [true, false]) {
        for (let step = 0; step < 120000 && !pos; step++) {
          const t = step * 0.025;
          const r = 0.35 * t;
          const x = CX + Math.cos(t) * r * spread;
          const y = CY + Math.sin(t) * r * 0.52;
          const b: [number, number, number, number] = [x - boxw / 2, y - boxh / 2, boxw, boxh];
          if (b[0] < FIELD_SIDE || b[0] + boxw > LAYOUT.W - FIELD_SIDE || b[1] < FIELD_TOP || b[1] + boxh > LAYOUT.H - FIELD_BOTTOM) continue;
          const padded: [number, number, number, number] = [b[0] - gap, b[1] - gap, boxw + 2 * gap, boxh + 2 * gap];
          const blocked = placed.some((q) => overlaps(b, q.box) || (enforceGap && q.subtheme === it.subtheme && overlaps(padded, q.box)));
          if (!blocked) {
            pos = [x, y];
            placed.push({ box: b, subtheme: it.subtheme });
          }
        }
        if (pos) break;
      }
      if (pos) break;
    }
    out[i].home = pos ?? [CX, CY];
    out[i].refFS = fs;
    out[i].lines = lines;
  }
  return out;
}

// Parents used to size up to 25px (PARENT_SIZE_MIN 12 + PARENT_SIZE_RANGE
// 13) against children's 9.5-20px, then also drew at a heavier weight
// (phase1CloudDraw.ts's "600" vs children's "400") — the two compounded so
// the 27 surviving parents, at p=1, filled roughly as much visual ink as
// the 126 children had, and the reduction from "many" to "few" didn't read.
// Sharing one MIN/RANGE pair (and, in phase1CloudDraw.ts, one font weight)
// between parentFontSize and childFontSize means a fully-absorbed parent is
// sized the same way a child ever was — the drop from 126 words to 27 has
// to be felt through the empty canvas around them, not through each
// survivor ballooning to compensate.
const SHARED_SIZE_MIN = 9.5;
const SHARED_SIZE_RANGE = 10.5;

export function parentFontSize(w01: number): number {
  return SHARED_SIZE_MIN + SHARED_SIZE_RANGE * Math.sqrt(Math.max(0, w01));
}
export function childFontSize(n01: number): number {
  return SHARED_SIZE_MIN + SHARED_SIZE_RANGE * Math.sqrt(Math.max(0, n01));
}

export interface Phase1CloudParent extends PlacedSlot {
  id: number;
  label: string;
  subtheme: number;
  w: number;
  w01: number;
  total: number;
  delay: number;
}
export interface Phase1CloudChild extends PlacedSlot {
  label: string;
  subtheme: number;
  parent: number;
  count: number;
  n01: number;
  delay: number;
}
export interface Phase1CloudLayout {
  parents: Phase1CloudParent[];
  children: Phase1CloudChild[];
}

// Every subtheme absorbs its concepts' children in sequence, so the
// consolidation reads as one subtheme distilling at a time — ported from
// the sketch's own delay assignment, same 0.52/0.04/0.12 constants.
const N_SUBTHEME = 8;
export const SPAN = 0.3;

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How far along a child is in its journey toward its parent, given global
 * progress `p` (0-1). Eased, clamped, zero before `delay` and one by
 * `delay + SPAN`. */
export function childProgress(delay: number, p: number): number {
  return ease(clamp01((p - delay) / SPAN));
}

/** Each parent's accumulated child weight at progress `p`, indexed the same
 * as `layout.parents`. At p=1 this equals every parent's own `total`
 * exactly (every child fully absorbed). */
export function computeAbsorption(layout: Phase1CloudLayout, p: number): number[] {
  const acc = layout.parents.map(() => 0);
  layout.children.forEach((c) => {
    acc[c.parent] += c.count * childProgress(c.delay, p);
  });
  return acc;
}

/** Builds the static layout once: places all 126 children and 27 parents
 * via the seeded spiral packer, then assigns each a staggered delay.
 * Deterministic — the same seed always produces the same layout. */
export function buildPhase1Cloud(seed = 20260826): Phase1CloudLayout {
  const rand = mulberry32(seed);

  const parentSeeds = PHASE1_CONCEPTS.map((c: Phase1Concept, i: number) => ({ id: i, label: c.label, subtheme: c.subtheme, w: c.w }));
  const maxW = Math.max(...parentSeeds.map((p) => p.w));
  const childSeeds = PHASE1_CONCEPTS.flatMap((c: Phase1Concept, pi: number) =>
    c.from.map((child) => ({ label: child.label, subtheme: c.subtheme, parent: pi, count: child.count })),
  );
  const maxCount = Math.max(...childSeeds.map((c) => c.count));

  const placedChildren = place(childSeeds, (c) => childFontSize(c.count / maxCount), 1.35, rand);
  const placedParents = place(parentSeeds, (p) => parentFontSize(p.w / maxW), 1.3, rand);

  const parents: Phase1CloudParent[] = placedParents.map((p) => ({
    ...p,
    w01: p.w / maxW,
    total: PHASE1_CONCEPTS[p.id].from.reduce((a, f) => a + f.count, 0),
    delay: (p.subtheme / N_SUBTHEME) * 0.52 + rand() * 0.04,
  }));
  const children: Phase1CloudChild[] = placedChildren.map((c) => ({
    ...c,
    n01: c.count / maxCount,
    delay: parents[c.parent].delay + rand() * 0.12,
  }));

  return { parents, children };
}

/** Computed once at module load — see this file's own header comment for
 * why every real consumer should import this instead of calling
 * buildPhase1Cloud() itself. */
export const PHASE1_CLOUD_LAYOUT: Phase1CloudLayout = buildPhase1Cloud();
