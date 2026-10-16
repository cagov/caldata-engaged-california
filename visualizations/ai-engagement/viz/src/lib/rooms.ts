/**
 * Pure, DOM-free, deterministic ring geometry for the deliberation-rooms
 * prototype: 14 conversation sessions arranged as one big ring, each session
 * itself a small circle of attendee dots orbiting a facilitator. No force
 * simulation, no relaxation, no jitter — every position here is a closed-
 * form point on a circle, so the same inputs always produce the exact same
 * layout (unlike swarm.ts's packSwarm, this module has nothing to pack: a
 * ring's positions are evenly spaced by construction, not by search).
 *
 * Angle convention (shared by roomRing and ringPositions): this module works
 * in standard SVG coordinates, where y increases *downward*. Angles are
 * measured the usual math way — x = cx + r*cos(theta), y = cy + r*sin(theta)
 * — with theta = -PI/2 pointing straight up (12 o'clock), since sin(-PI/2)
 * is -1 and a smaller y is higher on screen. The useful consequence of using
 * a y-down frame with this otherwise-textbook parametrization: *increasing*
 * theta sweeps clockwise as rendered, not counterclockwise as it would in a
 * normal y-up math plot. (Flipping the y-axis reverses the sense of
 * rotation for a fixed formula.) So "start at 12 and go clockwise" is just
 * "start at theta = -PI/2 and increase theta by a fixed step per point" —
 * no sign flip or axis juggling needed. See rooms.test.ts's clockwise test
 * for a worked-out on-screen check of this.
 */

export interface Point {
  x: number;
  y: number;
}

/** 12 o'clock in this module's y-down angle convention — see the header
 * comment. The default start angle for both roomRing's ring and
 * ringPositions. */
export const TOP_ANGLE = -Math.PI / 2;

export interface RoomRingOpts {
  /** Uniform radius of every room's own circle. Deliberately the same for
   * all rooms regardless of attendee count: equal circles read as
   * comparable at a glance, and headcount is legible from the dot count
   * instead (5-12 dots is countable) — sizing rooms by headcount was
   * considered and rejected. */
  roomRadius: number;
  /** Minimum edge-to-edge clearance between adjacent room circles, measured
   * along the ring. Feeds directly into the radius formula below; raising
   * it grows the ring rather than letting rooms crowd together. */
  gap: number;
  /**
   * Minimum radius to keep clear at the ring's center for headline copy,
   * regardless of what the room-count/gap formula alone would produce.
   * Optional: most callers just take whatever center hole the formula
   * happens to yield (see centerFreeRadius below) and size their headline
   * to fit it, rather than the other way around.
   */
  headlineRadius?: number;
}

export interface RoomRing {
  /** Each room's center, one per room, in ring-local coordinates — i.e.
   * relative to the ring's own center at (0, 0), index 0 at 12 o'clock,
   * increasing index clockwise. The caller (a Svelte component with an SVG
   * viewBox) is responsible for translating these to wherever the ring sits
   * on screen; this module never assumes a canvas size. */
  centers: Point[];
  /** The ring's radius R — the distance from the ring's center to every
   * room's center. Derived, never hard-coded: R = count * (2*roomRadius +
   * gap) / (2*PI), i.e. the ring's circumference is exactly big enough to
   * give every room its diameter plus the minimum gap, spread evenly. */
  ringRadius: number;
  /** Echoed back from opts for convenience, since a caller positioning
   * rooms usually needs both numbers together (e.g. to compute each room's
   * own bounding box). */
  roomRadius: number;
  /** Radius of the clear circle at the ring's center, available for
   * headline copy: the distance from the ring's center out to the *nearest*
   * point of any room's circle, i.e. ringRadius - roomRadius. (A room's
   * center sits at distance ringRadius from the origin; its near edge is
   * roomRadius closer than that.) At the brief's worked numbers
   * (roomRadius=46, gap=14, count=14 -> ringRadius ~236) this comes out to
   * ~190, i.e. a ~380px hole across — matches the brief's sanity check
   * without 380 ever being written down as a constant. */
  centerFreeRadius: number;
}

/**
 * Lay out `count` rooms evenly around a ring, sized so that no two rooms
 * touch even at the room count and radius the prototype actually uses (14
 * rooms, roomRadius 46, gap 14 -> ringRadius ~236 — see RoomRing.ringRadius).
 * Non-iterative: the radius formula guarantees the minimum gap analytically,
 * so there's nothing to relax or resolve after the fact.
 */
export function roomRing(count: number, opts: RoomRingOpts): RoomRing {
  const { roomRadius, gap, headlineRadius } = opts;
  const n = Math.max(0, Math.floor(count));

  // The brief's formula, applied verbatim: circumference 2*pi*R must fit
  // n rooms' worth of (diameter + gap) laid end to end around the ring.
  const formulaRadius = n > 0 ? (n * (2 * roomRadius + gap)) / (2 * Math.PI) : 0;

  // headlineRadius is a floor, not a replacement, and only applies when the
  // caller actually asks for it — omitting it (the common case) must not
  // silently impose a minimum ring size of one roomRadius even at count=0.
  const ringRadius =
    headlineRadius === undefined ? formulaRadius : Math.max(formulaRadius, headlineRadius + roomRadius);

  return {
    centers: n > 0 ? ringPositions({ x: 0, y: 0 }, ringRadius, n) : [],
    ringRadius,
    roomRadius,
    centerFreeRadius: Math.max(ringRadius - roomRadius, 0),
  };
}

/**
 * `n` points evenly spaced 2*PI/n apart on a circle of `radius` around
 * `center`, starting at `startAngle` (default TOP_ANGLE, i.e. 12 o'clock —
 * see the header comment for why increasing index then reads as clockwise
 * on screen with no further adjustment). Used both for the room ring itself
 * (roomRing delegates here) and for attendee dots orbiting a facilitator
 * inside a single room — the same evenly-spaced-points primitive, just at a
 * different radius and n.
 */
export function ringPositions(center: Point, radius: number, n: number, startAngle: number = TOP_ANGLE): Point[] {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];

  const step = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => {
    const theta = startAngle + i * step;
    return {
      x: center.x + radius * Math.cos(theta),
      y: center.y + radius * Math.sin(theta),
    };
  });
}
