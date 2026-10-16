/**
 * A tiny, pure geometry helper for DeliberationRooms.svelte's orbit
 * animation. Not part of lib/rooms.ts (which the brief says to import from,
 * not extend) — this is a separate, narrowly-scoped fix for a real bug
 * found in review: `.orbit`'s `transform-box: fill-box; transform-origin:
 * center` rotates around the *bounding-box center* of everything inside
 * the `<g>`, not around the room's own center point. Attendee dots sit on
 * `ringPositions(roomCenter, innerRadius, n)`, which is only 2-fold
 * symmetric (and therefore centered on roomCenter) for even `n` — odd `n`
 * (5, 7, 9, 11, 13 attendees all occur in the real data) leaves the dots'
 * own bounding box measurably off-center, so the whole constellation
 * visibly orbits the wrong point.
 *
 * Fix: include one paint-free (fill:none, stroke:none) circle of radius
 * `orbitAnchorRadius(innerRadius, dotR)`, centered exactly on the room's
 * center, inside the same `<g>`. SVG's bounding-box calculation (what
 * `fill-box` reads) is based on geometry, not paint, so this circle still
 * counts — and because every dot sits on a circle of radius `innerRadius`
 * (so each of its coordinates individually has magnitude <= innerRadius)
 * plus its own radius `dotR`, every dot's bounding box is provably
 * contained inside the anchor's. That forces the aggregate bounding box —
 * and therefore the rotation center — to be exactly the room's center, for
 * *any* dot count: even, odd, one, or (degenerately) zero.
 */

export function orbitAnchorRadius(innerRadius: number, dotR: number): number {
  return innerRadius + dotR;
}

export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The axis-aligned bounding box of a circle — what SVG's getBBox()
 * (and therefore `transform-box: fill-box`) computes for one, regardless
 * of its fill/stroke paint. */
export function circleBBox(cx: number, cy: number, r: number): BBox {
  return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxCenter(box: BBox): { x: number; y: number } {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}
