/**
 * Pure geometry for the person pictogram ParticipantFunnelCloud.svelte stamps
 * in place of a plain dot from stage 2 ("Phase 2") onward — a head-and-
 * shoulders silhouette from design/noun_person_8354641.svg (Noun Project),
 * copied verbatim here as a single path string so the component can build a
 * `Path2D` from it once at module scope. No `Path2D` in this file itself:
 * that's a DOM/Canvas global, and these tests run under bare node:test.
 */

/** The glyph's one <path>, copied verbatim from
 * design/noun_person_8354641.svg's 1200x1200 viewBox. */
export const PERSON_PATH =
  "m362.48 350.02c0-63 25.031-123.42 69.562-167.95 44.578-44.531 104.95-69.562 167.95-69.562s123.37 25.031 167.95 69.562c44.531 44.531 69.562 104.95 69.562 167.95 0 62.953-25.031 123.37-69.562 167.9-44.578 44.578-104.95 69.562-167.95 69.562s-123.37-24.984-167.95-69.562c-44.531-44.531-69.562-104.95-69.562-167.9zm272.02 262.5h-69c-94.266 0.09375-184.6 37.594-251.26 104.25-66.609 66.656-104.11 156.98-104.25 251.26 0.046874 37.453 25.641 70.031 62.016 78.984 107.25 26.953 217.4 40.547 327.98 40.5 110.58 0.046876 220.74-13.547 327.98-40.5 36.375-8.9531 61.969-41.531 62.016-78.984-0.14063-94.266-37.641-184.6-104.25-251.26-66.656-66.656-156.98-104.16-251.26-104.25z";

/** The path's own bounding box, measured directly from its coordinates (not
 * the 1200x1200 viewBox, which has generous margin on every side) — so a
 * caller can scale-then-translate around the glyph's true center rather than
 * the viewBox's. Landing exactly on (600, 600) is what lets the component's
 * transform be a plain translate/scale/translate with no extra offset. */
export const PERSON_BOX = {
  x: 209.99,
  y: 112.5,
  w: 780.02,
  h: 974.99,
  cx: 600,
  cy: 600,
};

/** How much taller than a dot's diameter the person glyph is drawn — tuned
 * against the real 14-session layout's tightest seat spacing (see
 * funnelCloud.ts's SEAT_SPACING comment and funnelCloud.test.ts's overlap
 * invariants). Raising this needs the same headroom check re-run, not just a
 * visual eyeball, since a few tenths here is the difference between clear
 * seats and touching figures at the smallest orbit ring. */
export const PERSON_SCALE = 1.55;

/** The glyph's height, in canvas px, for a dot that would otherwise be drawn
 * at radius `r`. */
export function personHeightFor(r: number): number {
  return PERSON_SCALE * 2 * r;
}

/** The glyph's width at the same size, preserving PERSON_BOX's own aspect
 * ratio — used by the overlap invariants below and by anything laying out
 * around the glyph horizontally. */
export function personWidthFor(r: number): number {
  return personHeightFor(r) * (PERSON_BOX.w / PERSON_BOX.h);
}
