/**
 * Two pieces of pure SVG path math for DistillTree.svelte's tree/flower
 * layout, in the style of rooms.ts: no DOM, no measurement, closed-form.
 *
 * taperedRadialBranch draws a FILLED tapering limb between two points — the
 * thing a plain `stroke-width` can't do, since stroke width is constant
 * along a path. bundlePath draws an OPEN stroked strand from an outer bud,
 * through a via point (typically its parent's position, or a point along
 * the hierarchy), to its ultimate target — used for the fringe's bundled
 * many-to-many strands so shared parentage visibly braids together.
 */
import type { Point } from "./rooms.ts";

function normal(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Rotate the unit direction vector 90 degrees.
  return { x: -dy / len, y: dx / len };
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

/**
 * A filled path for a limb from `from` (width w0) to `to` (width w1),
 * tapering linearly between them. Built as two offset edges (one on each
 * side of the from->to line, each a cubic Bezier through the two points'
 * perpendicular offsets) joined into a single closed outline.
 */
export function taperedRadialBranch(from: Point, to: Point, w0: number, w1: number): string {
  const n = normal(from, to);
  const fromA: Point = { x: from.x + (n.x * w0) / 2, y: from.y + (n.y * w0) / 2 };
  const fromB: Point = { x: from.x - (n.x * w0) / 2, y: from.y - (n.y * w0) / 2 };
  const toA: Point = { x: to.x + (n.x * w1) / 2, y: to.y + (n.y * w1) / 2 };
  const toB: Point = { x: to.x - (n.x * w1) / 2, y: to.y - (n.y * w1) / 2 };

  // Control points at the midpoint between from/to on each offset edge —
  // enough to read as a gentle organic taper without needing per-caller
  // tuning; a straight-line taper (control point = the offset point itself)
  // was tried first and reads as a wedge, not a limb.
  const midA: Point = { x: (fromA.x + toA.x) / 2, y: (fromA.y + toA.y) / 2 };
  const midB: Point = { x: (fromB.x + toB.x) / 2, y: (fromB.y + toB.y) / 2 };

  return [
    `M ${fmt(fromA.x)} ${fmt(fromA.y)}`,
    `C ${fmt(midA.x)} ${fmt(midA.y)} ${fmt(midA.x)} ${fmt(midA.y)} ${fmt(toA.x)} ${fmt(toA.y)}`,
    `L ${fmt(toB.x)} ${fmt(toB.y)}`,
    `C ${fmt(midB.x)} ${fmt(midB.y)} ${fmt(midB.x)} ${fmt(midB.y)} ${fmt(fromB.x)} ${fmt(fromB.y)}`,
    "Z",
  ].join(" ");
}

/**
 * An open stroked path from `leaf` (an outer Phase 1 bud) to `target` (its
 * concept), pulled toward `via` (typically the concept's parent subtheme or
 * theme position) by `tension` in [0, 1]. tension=0 draws close to a
 * straight line leaf->target; tension=1 pulls the curve's control points all
 * the way to `via`, so strands sharing a `via` visually braid together —
 * the hierarchical-edge-bundling effect the spec's Task 4 calls for.
 */
export function bundlePath(leaf: Point, via: Point, target: Point, tension: number): string {
  const t = Math.max(0, Math.min(1, tension));
  const c1: Point = { x: leaf.x + (via.x - leaf.x) * t, y: leaf.y + (via.y - leaf.y) * t };
  const c2: Point = { x: target.x + (via.x - target.x) * t, y: target.y + (via.y - target.y) * t };
  return `M ${fmt(leaf.x)} ${fmt(leaf.y)} C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(target.x)} ${fmt(target.y)}`;
}
