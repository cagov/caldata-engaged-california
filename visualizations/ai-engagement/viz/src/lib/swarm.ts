/**
 * Pure, DOM-free, deterministic packed-blob layout: one hex lattice per
 * group, all at the exact same dot-to-dot pitch regardless of group size —
 * so every blob in the chart reads as the same density, just a different
 * area (see packHexPoints). No force simulation, no per-blob stretching:
 * both would make spacing vary blob to blob, which is the thing this file
 * exists to avoid.
 */

export interface SwarmItem {
  id: string;
  group: number;
}

export interface SwarmOpts {
  groups: number;
  width: number;
  height: number;
  r: number;
  gap: number;
  /**
   * Where each group's blob is centered, indexed by group. Optional: when
   * omitted, packSwarm falls back to the original single-row-across-the-
   * full-width layout (see singleRowCells below), so every caller that
   * predates the grid layout (most of tests/swarm.test.ts) is unaffected.
   */
  cells?: GroupCell[];
}

/** Where one group's blob is centered within a (possibly multi-row) grid
 * layout. Packing itself is unconstrained by row/column boundaries — a
 * blob is simply as big as its dot count makes it (see packHexPoints) — so
 * unlike an early version of this file, a cell carries no width/height
 * budget for packing to respect. computeGroupGrid still spaces cells far
 * enough apart that neighboring blobs never touch. */
export interface GroupCell {
  x: number;
  y: number;
}

export interface PositionedDot {
  id: string;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

// Golden angle: successive points at this angular step never re-align,
// which is what makes a phyllotaxis spiral fill a disc without gaps or
// coincident points. Used only by packCircle below.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Vertical distance between adjacent rows of a triangular/hex lattice at
// pitch 1 — the standard sqrt(3)/2 row-height factor.
const HEX_ROW_HEIGHT_FACTOR = Math.sqrt(3) / 2;

/**
 * Radius of the roughly-circular hex-lattice blob holding `n` dots at a
 * fixed pitch `step` (center-to-center spacing): the exact inverse of
 * packHexPoints' fill order (not an approximation), found by equating the
 * blob's area (πR²) to n times the lattice's per-point Voronoi cell area
 * (step² · √3/2, a hex cell's area at that pitch).
 */
function hexBlobRadius(n: number, step: number): number {
  return step * Math.sqrt((n * Math.sqrt(3)) / (2 * Math.PI));
}

/**
 * The n hex-lattice points nearest the origin, at a fixed pitch `step`
 * (center-to-center spacing). Every call with the same `step` produces
 * identically-spaced dots regardless of n — only the blob's radius grows
 * with n (via hexBlobRadius) — so every blob in the chart reads as the same
 * density. Deterministic and non-iterative: no simulation, no per-call
 * tuning, sub-millisecond even at corpus scale (~2678 dots).
 *
 * Rows alternate offset by step/2 (a standard triangular lattice).
 * Candidates are generated out to a radius with generous margin over the
 * blob's expected size, sorted by distance from the origin — angle as a
 * tiebreak, for a stable order — then truncated to n. Starting from the
 * origin and filling outward in shells means there's always a dot at the
 * blob's own center, unlike a golden-angle spiral (packCircle) or an
 * annulus with a reserved hole.
 */
function packHexPoints(n: number, step: number): Point[] {
  if (n <= 0) return [];

  const rowHeight = step * HEX_ROW_HEIGHT_FACTOR;
  const estRadius = hexBlobRadius(n, step);
  // Margin verified against n up to 2000+: the actual farthest point never
  // exceeds the area-based estimate by more than ~2px, but the margin here
  // is generous on top of that so the candidate grid always contains at
  // least n points regardless of n's size.
  const maxRadius = estRadius * 1.5 + step * 3;
  const rowCount = Math.max(2, Math.ceil(maxRadius / rowHeight));
  const colCount = Math.max(2, Math.ceil(maxRadius / step) + 1);

  const candidates: { x: number; y: number; d2: number; theta: number }[] = [];
  for (let j = -rowCount; j <= rowCount; j++) {
    const y = j * rowHeight;
    const xOffset = j % 2 !== 0 ? step / 2 : 0;
    for (let i = -colCount; i <= colCount; i++) {
      const x = i * step + xOffset;
      candidates.push({ x, y, d2: x * x + y * y, theta: Math.atan2(y, x) });
    }
  }
  candidates.sort((a, b) => a.d2 - b.d2 || a.theta - b.theta);
  return candidates.slice(0, n).map(({ x, y }) => ({ x, y }));
}

/**
 * Lay out `items` as one hex-lattice blob per group index in
 * [0, opts.groups), each blob centered at its cell (see opts.cells) and
 * sized purely by its own item count — no stretching, no cross-group
 * collision resolution needed, since computeGroupGrid already spaces
 * cells far enough apart that same-pitch blobs never touch.
 */
export function packSwarm(items: SwarmItem[], opts: SwarmOpts): PositionedDot[] {
  const { groups, r, gap } = opts;
  const step = r * 2 + gap;

  const counts = new Array(groups).fill(0);
  for (const item of items) counts[item.group]++;

  // opts.cells lets the caller lay groups out as a multi-row grid (see
  // computeGroupGrid); callers that don't care (every test, and any future
  // single-row use) get the original single-row-across-the-full-width
  // layout for free.
  const cells = opts.cells ?? singleRowCells(counts, opts);
  const pointsByGroup = counts.map((n) => packHexPoints(n, step));

  const groupCursor = new Array(groups).fill(0);
  return items.map((item) => {
    const i = groupCursor[item.group]++;
    const cell = cells[item.group];
    const p = pointsByGroup[item.group][i];
    return { id: item.id, x: cell.x + p.x, y: cell.y + p.y };
  });
}

/** packSwarm's original layout, expressed as one row of cells spanning the
 * full chart width — the fallback when the caller doesn't pass its own
 * `opts.cells` grid. */
function singleRowCells(counts: number[], opts: Pick<SwarmOpts, "width" | "height" | "r" | "gap">): GroupCell[] {
  const centers = computeGroupCenters(counts, opts);
  const midY = opts.height / 2;
  return centers.map((x) => ({ x, y: midY }));
}

export type CircleOrder = "input" | "radial" | "angular";

// Fraction of the outer radius left empty at the center for a headline —
// the annulus's inner edge. Chosen to fit a 3-line headline at the size
// CircleSwarm.svelte renders at (size=620 → outer radius ~285px, inner
// ~120px across).
const CIRCLE_INNER = 0.42;
// Inset from the plot box edge.
const CIRCLE_PAD = 10;

/**
 * Lay out `items` as a single golden-angle (Vogel) annulus, with a hole
 * reserved at the center for a headline. Deterministic and non-iterative,
 * like packHexPoints, though its spiral texture (rather than a lattice)
 * is deliberate here — see the "Circle" prototypes, unaffected by the
 * beeswarm split's move to hex-lattice packing above.
 *
 * `order` controls which respondent lands at which position, not the
 * position set itself — all three CircleOrder values produce the exact
 * same 2678 coordinates (see packCircle's tests), so the no-overlap
 * guarantee below holds for every order at once:
 *
 * - "input": position i goes to items[i] — colors speckle evenly.
 * - "radial": items are stably sorted by group first, so each group claims
 *   a contiguous run of positions in index order. Since position i sits at
 *   radius ∝ sqrt(i) (see below), a contiguous run of indices is a
 *   contiguous *radius* range — each group becomes a concentric band.
 * - "angular": items are stably sorted by group, then positions are handed
 *   out sorted by polar angle instead of index order — each group becomes
 *   one angular wedge instead of one radial band.
 *
 * Radial progression maps the unit disc's radial CDF onto [CIRCLE_INNER, 1]:
 *   t_i = sqrt(CIRCLE_INNER^2 + (1 - CIRCLE_INNER^2) * (i + 0.5) / n)
 * This keeps density uniform across the ring (an area-preserving
 * reparametrization, CDF-shifted to skip the inner disc) and gives a
 * minimum pairwise separation of >= rho * 1.546/sqrt(n), where rho is the
 * outer radius (the same 1.546/sqrt(n) unit-disc Vogel-spiral bound a
 * previous version of this file derived for packOval, since excluding the
 * inner disc only raises the minimum separation relative to that solid-disc
 * case). The +0.5 offset keeps the very first point off dead-center — for
 * the same reason, don't drop it.
 */
export function packCircle(items: SwarmItem[], opts: SwarmOpts, order: CircleOrder = "input"): PositionedDot[] {
  const { width, height, r } = opts;
  const n = items.length;
  const [cx] = computeGroupCenters([n], opts);
  const cy = height / 2;

  if (n === 0) return [];
  if (n === 1) return [{ id: items[0].id, x: cx, y: cy }];

  const rho = Math.max(Math.min(width, height) / 2 - r - CIRCLE_PAD, 0);
  const innerSq = CIRCLE_INNER * CIRCLE_INNER;

  // Positions, indexed by their slot i in the golden-angle sequence —
  // computed once and reused regardless of `order`, which only changes the
  // mapping from item to slot.
  const slotX: number[] = new Array(n);
  const slotY: number[] = new Array(n);
  const slotTheta: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.sqrt(innerSq + (1 - innerSq) * ((i + 0.5) / n));
    const theta = i * GOLDEN_ANGLE;
    slotX[i] = cx + rho * t * Math.cos(theta);
    slotY[i] = cy + rho * t * Math.sin(theta);
    slotTheta[i] = theta;
  }

  if (order === "input") {
    return items.map((item, i) => ({ id: item.id, x: slotX[i], y: slotY[i] }));
  }

  // "radial" and "angular" both start from items stably sorted by group —
  // that's what makes each group's positions a contiguous run.
  const itemOrder = items.map((_, i) => i).sort((a, b) => items[a].group - items[b].group);

  const slotOrder =
    order === "angular"
      ? slotTheta
          .map((theta, i) => [((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), i] as const)
          .sort((a, b) => a[0] - b[0])
          .map(([, i]) => i)
      : slotX.map((_, i) => i); // "radial": natural index order == ascending radius

  const dots: PositionedDot[] = new Array(n);
  itemOrder.forEach((itemIdx, k) => {
    const slot = slotOrder[k];
    dots[itemIdx] = { id: items[itemIdx].id, x: slotX[slot], y: slotY[slot] };
  });
  return dots;
}

/**
 * The group-center x-positions packSwarm lays its blobs around, exposed
 * standalone so the UI can position axis labels under the actual blobs
 * without re-deriving the layout.
 */
export function computeGroupCenters(counts: number[], opts: Pick<SwarmOpts, "width" | "r" | "gap">): number[] {
  const step = opts.r * 2 + opts.gap;
  return layoutCenters(blobRadii(counts, step), opts.width, step);
}

/** Each group's blob radius at pitch `step` — see hexBlobRadius. The one
 * formula computeGroupCenters, computeGroupGrid, and packHexPoints all
 * share, so row spacing always matches what's actually drawn. */
function blobRadii(counts: number[], step: number): number[] {
  return counts.map((n) => hexBlobRadius(n, step));
}

/** Space blob centers left to right by their radii, then scale to fit `width`. */
function layoutCenters(blobRadius: number[], width: number, step: number): number[] {
  const centersRaw: number[] = [];
  let cursor = 0;
  for (const radius of blobRadius) {
    cursor += radius;
    centersRaw.push(cursor);
    cursor += radius + step * 2;
  }
  const rawSpan = cursor - step * 2;
  const usable = width - step * 2;
  const scale = rawSpan > 0 ? usable / rawSpan : 1;
  return centersRaw.map((c) => c * scale + step);
}

/**
 * Reassign which respondent sits at which position within their own group,
 * so respondents with a lower `rankOf` value end up nearer their group's
 * centroid — a dense core inside a hex blob, an inner band inside
 * packCircle's annulus, a core within a wedge — without moving any
 * coordinate itself. This is a pure permutation of `dots`: the output is
 * the exact same multiset of {x, y} pairs as the input, just paired with
 * different ids. That's what makes it overlap-free by construction (no new
 * geometry to collide) and cheap enough to run on every toggle (no worker,
 * no cache) — unlike packSwarm/packCircle, which this never calls.
 *
 * Distance-from-centroid, not slot index, is the ranking: slot index means
 * something different in every prototype (radius for packCircle's "input"
 * and "radial" orders, polar angle for "angular"), and packHexPoints has no
 * slot index at all in the caller's view. Centroid distance is the one rule
 * that reads as "core" everywhere a group's points can appear — including a
 * concentric band, whose own centroid is the circle's center, so distance
 * from it is just radius.
 *
 * Ties (equal distance) break on angle from the centroid — the same d2 ||
 * theta order packHexPoints uses to fill a lattice deterministically — so a
 * symmetric shell of equidistant points always resolves the same way.
 *
 * `rankOf` need not be binary: any per-respondent integer works, and ties in
 * `rankOf` itself break on each respondent's original relative order (a
 * stable sort), not centroid distance — that's what lets a caller compose
 * two independent rankings (e.g. "theme match" as the high-order digit,
 * "category" as the low-order one) into nested bands with a single call.
 *
 * `groupOf` and `rankOf` are indexed the same way as `dots` (respondent
 * order), not by group — same convention as SwarmItem elsewhere in this
 * file. Returns `dots` unchanged if the three arrays' lengths disagree,
 * since that means the caller passed mismatched data.
 */
export function clusterByRank(dots: PositionedDot[], groupOf: number[], rankOf: number[]): PositionedDot[] {
  if (dots.length !== groupOf.length || dots.length !== rankOf.length) return dots;

  const groups = new Map<number, number[]>();
  dots.forEach((_, i) => {
    const g = groupOf[i];
    const list = groups.get(g);
    if (list) list.push(i);
    else groups.set(g, [i]);
  });

  const result: PositionedDot[] = new Array(dots.length);

  for (const indices of groups.values()) {
    const cx = indices.reduce((sum, i) => sum + dots[i].x, 0) / indices.length;
    const cy = indices.reduce((sum, i) => sum + dots[i].y, 0) / indices.length;

    // The group's coordinates, ranked nearest-to-centroid-first — this is
    // the pool of slots clustering hands out, independent of which
    // respondent originally held which one.
    const ranked = indices
      .map((i) => {
        const dx = dots[i].x - cx;
        const dy = dots[i].y - cy;
        return { x: dots[i].x, y: dots[i].y, d2: dx * dx + dy * dy, theta: Math.atan2(dy, dx) };
      })
      .sort((a, b) => a.d2 - b.d2 || a.theta - b.theta);

    // A stable sort by rankOf: respondents tied on rank keep their original
    // relative order, so the permutation is deterministic rather than
    // arbitrary among ties.
    const order = [...indices].sort((a, b) => rankOf[a] - rankOf[b]);

    order.forEach((i, k) => {
      result[i] = { id: dots[i].id, x: ranked[k].x, y: ranked[k].y };
    });
  }

  return result;
}

/**
 * "Cluster matches" — the boolean special case of clusterByRank: matched
 * respondents (rank 0) end up innermost, unmatched (rank 1) outermost.
 */
export function clusterMatched(dots: PositionedDot[], groupOf: number[], matched: boolean[]): PositionedDot[] {
  return clusterByRank(
    dots,
    groupOf,
    matched.map((m) => (m ? 0 : 1)),
  );
}

/** Groups per row before wrapping to a new one — past this, labels and
 * blobs get too cramped along a single axis (FIELD_OF_WORK's 12 values are
 * the case this exists for). */
export const MAX_GROUPS_PER_ROW = 6;

export interface GroupGrid {
  /** Group indices, partitioned into rows top to bottom. Preserves the
   * original group order — rows are contiguous slices, not a re-sort. */
  rows: number[][];
  /** Per-group center x, indexed by group (row-local, not row-relative). */
  x: number[];
  /** Per-group blob radius, indexed by group — see hexBlobRadius. */
  radius: number[];
}

/**
 * Partition `counts.length` groups into rows of at most `maxPerRow` (default
 * MAX_GROUPS_PER_ROW), balancing the last row instead of leaving it
 * lopsided — 7 groups become 4+3, not 6+1 — then lay out each row
 * independently across the full chart width, exactly as computeGroupCenters
 * does for a single row. Vertical placement (row heights, y-positions) is
 * left to the caller: it depends on wrapped label heights, which is
 * typography the caller owns, not this pure geometry helper.
 */
export function computeGroupGrid(
  counts: number[],
  opts: Pick<SwarmOpts, "width" | "r" | "gap"> & { maxPerRow?: number },
): GroupGrid {
  const step = opts.r * 2 + opts.gap;
  const radius = blobRadii(counts, step);
  const maxPerRow = opts.maxPerRow ?? MAX_GROUPS_PER_ROW;
  const k = counts.length;
  const numRows = Math.max(1, Math.ceil(k / maxPerRow));
  const perRow = Math.ceil(k / numRows);

  const rows: number[][] = [];
  for (let start = 0; start < k; start += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, k - start) }, (_, i) => start + i));
  }

  const x = new Array(k).fill(0);
  for (const row of rows) {
    const rowCenters = layoutCenters(
      row.map((g) => radius[g]),
      opts.width,
      step,
    );
    row.forEach((g, i) => {
      x[g] = rowCenters[i];
    });
  }

  return { rows, x, radius };
}
