import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packSwarm,
  packCircle,
  computeGroupCenters,
  computeGroupGrid,
  clusterMatched,
  clusterByRank,
  type GroupCell,
  type SwarmItem,
  type CircleOrder,
  type PositionedDot,
} from "../src/lib/swarm.ts";

const OPTS = { groups: 3, width: 600, height: 200, r: 2.5, gap: 1 };
const PITCH = OPTS.r * 2 + OPTS.gap; // 6 — the exact center-to-center spacing packSwarm targets everywhere

function makeItems(countsByGroup: number[]): SwarmItem[] {
  const items: SwarmItem[] = [];
  countsByGroup.forEach((count, group) => {
    for (let i = 0; i < count; i++) items.push({ id: `g${group}-${i}`, group });
  });
  return items;
}

function byGroup(items: SwarmItem[], dots: { x: number; y: number }[]): Map<number, { x: number; y: number }[]> {
  const map = new Map<number, { x: number; y: number }[]>();
  items.forEach((item, i) => {
    const list = map.get(item.group) ?? [];
    list.push(dots[i]);
    map.set(item.group, list);
  });
  return map;
}

function minPairDist(points: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return min;
}

test("no two dots overlap, anywhere, across a range of group sizes", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);

  const minGap = PITCH - 1e-6;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
      assert.ok(
        dist >= minGap,
        `dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart, want >= ${minGap}`,
      );
    }
  }
});

test("every group gets the exact same dot-to-dot pitch, regardless of its size", () => {
  // The whole point of the hex-lattice rewrite: a group of 5 and a group of
  // 900 should read as the same density, not a looser or tighter pack.
  const counts = [5, 40, 900];
  const items = makeItems(counts);
  const dots = packSwarm(items, { groups: counts.length, width: 2000, height: 2000, r: 2.5, gap: 1 });
  const groups = byGroup(items, dots);

  for (const [group, points] of groups) {
    const min = minPairDist(points);
    assert.ok(
      Math.abs(min - PITCH) < 1e-6,
      `group ${group} (n=${points.length}) has nearest-neighbor spacing ${min.toFixed(4)}, want exactly ${PITCH}`,
    );
  }
});

test("every dot ends up nearest its own group's center, not a neighbor's", () => {
  const items = makeItems([30, 30, 30]);
  const dots = packSwarm(items, OPTS);
  const groups = byGroup(items, dots);

  const centroid = (list: { x: number; y: number }[]) => ({
    x: list.reduce((s, d) => s + d.x, 0) / list.length,
    y: list.reduce((s, d) => s + d.y, 0) / list.length,
  });
  const centroids = [...groups.entries()].map(([g, list]) => [g, centroid(list)] as const);

  for (const [group, list] of groups) {
    for (const dot of list) {
      const nearest = centroids.reduce((best, [g, c]) => {
        const d = Math.hypot(dot.x - c.x, dot.y - c.y);
        return d < best.d ? { g, d } : best;
      }, { g: -1, d: Infinity });
      assert.equal(
        nearest.g,
        group,
        `dot (${dot.x.toFixed(1)}, ${dot.y.toFixed(1)}) in group ${group} is nearest group ${nearest.g}'s centroid, not its own`,
      );
    }
  }
});

test("a group's blob has no hole — a dot sits at (or essentially at) its own center", () => {
  // The point of filling the hex lattice outward from the origin: unlike a
  // golden-angle spiral or an annulus, there's always a dot right at the
  // blob's own center, for any group size.
  const opts = { groups: 1, width: 400, height: 400, r: 2.5, gap: 1 };
  for (const n of [1, 2, 5, 50, 500, 2678]) {
    const items = makeItems([n]);
    const dots = packSwarm(items, opts);
    const [cx] = computeGroupCenters([n], opts);
    const cy = opts.height / 2;
    const nearestToCenter = Math.min(...dots.map((d) => Math.hypot(d.x - cx, d.y - cy)));
    assert.ok(nearestToCenter < 1e-6, `n=${n}: nearest dot to center is ${nearestToCenter.toFixed(3)}px away, want ~0`);
  }
});

test("no overlap holds even with a heavily skewed group (one big blob, two small)", () => {
  // Mirrors the shape of the real REGION breakdown (one group ~60x another).
  const items = makeItems([300, 40, 5]);
  const dots = packSwarm(items, { groups: 3, width: 1100, height: 420, r: 2.5, gap: 1 });

  const minGap = PITCH - 1e-6;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
      assert.ok(
        dist >= minGap,
        `dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart, want >= ${minGap}`,
      );
    }
  }
});

test("identical input produces byte-identical output across two runs", () => {
  const items = makeItems([15, 8, 3]);
  const a = packSwarm(items, OPTS);
  const b = packSwarm(items, OPTS);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("computeGroupCenters matches the centers packSwarm actually lays out around", () => {
  // The UI positions axis labels using computeGroupCenters independently of
  // running the full layout; they must agree, or labels drift from the
  // blobs they're meant to sit under.
  const counts = [40, 25, 10];
  const items = makeItems(counts);
  const dots = packSwarm(items, OPTS);
  const centers = computeGroupCenters(counts, OPTS);
  const groups = byGroup(items, dots);

  for (const [group, points] of groups) {
    const centroid = points.reduce((s, d) => s + d.x, 0) / points.length;
    assert.ok(
      Math.abs(centroid - centers[group]) < 3,
      `group ${group} centroid ${centroid.toFixed(2)} strays too far from computeGroupCenters' ${centers[group].toFixed(2)}`,
    );
  }
});

test("computeGroupCenters increases left to right and stays within the drawing width", () => {
  const centers = computeGroupCenters([10, 10, 10], OPTS);
  assert.ok(centers[0] < centers[1]);
  assert.ok(centers[1] < centers[2]);
  for (const c of centers) {
    assert.ok(c >= 0 && c <= OPTS.width);
  }
});

test("a single dense group (the 'All respondents' view, ~2678 dots) packs with uniform spacing and no overlap", () => {
  const opts = { groups: 1, width: 1100, height: 420, r: 2.5, gap: 1 };
  const items = makeItems([2678]);
  const dots = packSwarm(items, opts);

  const minGap = PITCH - 1e-6;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
      assert.ok(dist >= minGap, `dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart, want >= ${minGap}`);
    }
  }
  assert.ok(Math.abs(minPairDist(dots) - PITCH) < 1e-6, "nearest-neighbor spacing should be exactly the pitch");
});

test("a lone group reads as roughly circular, not stretched into an oval", () => {
  // A previous version of this file deliberately stretched the single-group
  // "All respondents" blob into a 2:1 oval. Uniform dot spacing rules that
  // out — every blob, including this one, is just as many hex-lattice
  // points as it has members, which is naturally close to circular.
  const items = makeItems([2678]);
  const dots = packSwarm(items, { groups: 1, width: 1100, height: 1100, r: 2.5, gap: 1 });

  const xs = dots.map((d) => d.x);
  const ys = dots.map((d) => d.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const aspect = width / height;
  assert.ok(
    Math.abs(aspect - 1) < 0.1,
    `bounding box is ${width.toFixed(0)}x${height.toFixed(0)} (aspect ${aspect.toFixed(2)}), expected ~1.0`,
  );
});

test("packSwarm without opts.cells reproduces the original single-row-across-the-full-width layout exactly", () => {
  // Regression guard: the default (no-cells) path must still center every
  // group exactly where computeGroupCenters puts it, on one shared row —
  // i.e. exactly what passing an explicit single-row cells array built the
  // same way would produce.
  const counts = [366, 147, 578, 652, 110, 393, 136, 9]; // REGION-shaped, skewed
  const opts = { groups: counts.length, width: 1100, height: 420, r: 2.5, gap: 1 };
  const items = counts.flatMap((n, g) => Array.from({ length: n }, (_, i) => ({ id: `g${g}-${i}`, group: g })));

  const centers = computeGroupCenters(counts, opts);
  const midY = opts.height / 2;
  const cells: GroupCell[] = centers.map((x) => ({ x, y: midY }));

  const withoutCells = packSwarm(items, opts);
  const withEquivalentCells = packSwarm(items, { ...opts, cells });
  assert.equal(
    JSON.stringify(withoutCells),
    JSON.stringify(withEquivalentCells),
    "the no-cells default path should match hand-built single-row cells exactly",
  );
});

test("computeGroupGrid puts at most 6 groups per row, balancing an overflow row instead of leaving it lopsided", () => {
  const six = computeGroupGrid(new Array(6).fill(10), { width: 1000, r: 2.5, gap: 1 });
  assert.equal(six.rows.length, 1);
  assert.deepEqual(six.rows[0], [0, 1, 2, 3, 4, 5]);

  const seven = computeGroupGrid(new Array(7).fill(10), { width: 1000, r: 2.5, gap: 1 });
  assert.deepEqual(
    seven.rows.map((r) => r.length),
    [4, 3],
    "7 groups should split 4+3, not 6+1",
  );
  assert.deepEqual(seven.rows.flat(), [0, 1, 2, 3, 4, 5, 6], "group order is preserved, rows are contiguous slices");

  const twelve = computeGroupGrid(new Array(12).fill(10), { width: 1000, r: 2.5, gap: 1 });
  assert.deepEqual(
    twelve.rows.map((r) => r.length),
    [6, 6],
  );
});

test("computeGroupGrid's centers increase left to right within each row and stay in [0, width]", () => {
  const grid = computeGroupGrid(new Array(9).fill(10), { width: 1000, r: 2.5, gap: 1 });
  for (const row of grid.rows) {
    for (let i = 1; i < row.length; i++) {
      assert.ok(grid.x[row[i]] > grid.x[row[i - 1]]);
    }
    for (const g of row) assert.ok(grid.x[g] >= 0 && grid.x[g] <= 1000);
  }
});

test("computeGroupGrid's radius scales as sqrt(n) and matches packSwarm's actual blob extent", () => {
  const counts = [25, 100, 400]; // 1x, 4x, 16x — radii should come out 1x, 2x, 4x
  const grid = computeGroupGrid(counts, { width: 3000, r: 2.5, gap: 1 });
  assert.ok(Math.abs(grid.radius[1] / grid.radius[0] - 2) < 0.05);
  assert.ok(Math.abs(grid.radius[2] / grid.radius[0] - 4) < 0.05);

  const items = counts.flatMap((n, g) => Array.from({ length: n }, (_, i) => ({ id: `g${g}-${i}`, group: g })));
  const cells: GroupCell[] = grid.x.map((x) => ({ x, y: 1500 }));
  const dots = packSwarm(items, { groups: counts.length, width: 3000, height: 3000, r: 2.5, gap: 1, cells });

  let idx = 0;
  counts.forEach((n, g) => {
    const slice = dots.slice(idx, idx + n);
    idx += n;
    const actualMaxR = Math.max(...slice.map((d) => Math.hypot(d.x - cells[g].x, d.y - cells[g].y)));
    assert.ok(
      actualMaxR <= grid.radius[g] + 3,
      `group ${g}: actual blob radius ${actualMaxR.toFixed(1)} exceeds the computeGroupGrid estimate ${grid.radius[g].toFixed(1)} by more than 3px`,
    );
  });
});

/** Mirrors Beeswarm.svelte's geometryFor row-height rule: each row's plot
 * height is 2x its largest blob radius plus a small fixed pad. Returns both
 * the cells and each row's plot half-height, since GroupCell itself no
 * longer carries a size budget (packing isn't constrained by it). */
function rowPaddedCellsFor(
  counts: number[],
  opts: { width: number; r: number; gap: number },
): { cells: GroupCell[]; rowOf: number[]; halfHeightOf: number[] } {
  const ROW_PAD = 8;
  const LABEL_BAND = 40; // stand-in for Beeswarm's label-band gap between rows
  const grid = computeGroupGrid(counts, opts);
  const cells: GroupCell[] = new Array(counts.length);
  const rowOf = new Array(counts.length);
  const halfHeightOf = new Array(counts.length);
  let cursor = 0;
  grid.rows.forEach((row, ri) => {
    const rowPlotHeight = Math.max(60, 2 * (Math.max(...row.map((g) => grid.radius[g])) + ROW_PAD));
    const plotTop = cursor + LABEL_BAND;
    row.forEach((g) => {
      rowOf[g] = ri;
      halfHeightOf[g] = rowPlotHeight / 2;
      cells[g] = { x: grid.x[g], y: plotTop + rowPlotHeight / 2 };
    });
    cursor = plotTop + rowPlotHeight;
  });
  return { cells, rowOf, halfHeightOf };
}

const REAL_TWO_ROW_SEGMENTS: [string, number[]][] = [
  ["AGE", [8, 107, 1182, 909, 290, 141, 41]],
  ["RACE_ETHNICITY_CATEGORY", [1422, 330, 243, 157, 97, 28, 21, 17, 363]],
];

for (const [name, counts] of REAL_TWO_ROW_SEGMENTS) {
  test(`packSwarm over the real ${name} counts (two rows) has uniform spacing, no overlap, and keeps every row inside its own cell`, () => {
    const opts = { width: 1100, r: 2.5, gap: 1 };
    const grid = computeGroupGrid(counts, opts);
    assert.equal(grid.rows.length, 2, `${name} should split into two rows`);

    const { cells, halfHeightOf } = rowPaddedCellsFor(counts, opts);
    const items = counts.flatMap((n, g) => Array.from({ length: n }, (_, i) => ({ id: `g${g}-${i}`, group: g })));
    const dots = packSwarm(items, { groups: counts.length, height: 0, ...opts, cells });

    const minGap = PITCH - 1e-6;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
        assert.ok(dist >= minGap, `${name}: dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart`);
      }
    }

    // The guarantee the row-height rule exists for: row 0's lowest dot never
    // reaches into row 1's label band (or vice versa) — every dot stays
    // within its own row's vertical half-height.
    let idx = 0;
    counts.forEach((n, g) => {
      const cell = cells[g];
      const halfHeight = halfHeightOf[g];
      for (let i = 0; i < n; i++) {
        const dot = dots[idx++];
        assert.ok(
          Math.abs(dot.y - cell.y) <= halfHeight,
          `${name} group ${g}: dot y=${dot.y.toFixed(1)} strays outside its row's plot box (cell.y=${cell.y.toFixed(1)}, halfHeight=${halfHeight.toFixed(1)})`,
        );
      }
    });
  });
}

test("packSwarm's single-group case honors an explicit cell instead of centering in the full box", () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, group: 0 }));
  const cell: GroupCell = { x: 300, y: 500 };
  const opts = { groups: 1, width: 1100, height: 1000, r: 2.5, gap: 1, cells: [cell] };
  const dots = packSwarm(items, opts);

  const avgX = dots.reduce((s, d) => s + d.x, 0) / dots.length;
  const avgY = dots.reduce((s, d) => s + d.y, 0) / dots.length;
  assert.ok(
    Math.abs(avgX - cell.x) < 1 && Math.abs(avgY - cell.y) < 1,
    `expected the blob centered at cell (${cell.x}, ${cell.y}), got avg (${avgX.toFixed(1)}, ${avgY.toFixed(1)})`,
  );
});

const CIRCLE_OPTS = { groups: 1, width: 620, height: 620, r: 2.5, gap: 1 };
const CIRCLE_ORDERS: CircleOrder[] = ["input", "radial", "angular"];

test("packCircle has no overlap at corpus scale, for every order", () => {
  const items = makeItems([2678]);
  const minGap = CIRCLE_OPTS.r * 2 - 0.05;

  for (const order of CIRCLE_ORDERS) {
    const dots = packCircle(items, CIRCLE_OPTS, order);
    assert.equal(dots.length, 2678);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
        assert.ok(
          dist >= minGap,
          `order=${order}: dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart, want >= ${minGap}`,
        );
      }
    }
  }
});

test("packCircle has no overlap across a range of group sizes, for every order", () => {
  const minGap = CIRCLE_OPTS.r * 2 - 0.05;

  for (const order of CIRCLE_ORDERS) {
    for (const n of [1, 2, 3, 7, 50, 500, 2678]) {
      const items = makeItems([n]);
      const dots = packCircle(items, CIRCLE_OPTS, order);
      assert.equal(dots.length, n);
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
          assert.ok(
            dist >= minGap,
            `order=${order}, n=${n}: dots ${dots[i].id} and ${dots[j].id} are ${dist.toFixed(2)}px apart, want >= ${minGap}`,
          );
        }
      }
    }
  }
});

test("packCircle reserves a clear center hole and stays inside the plot box", () => {
  const items = makeItems([2678]);
  const [cx] = computeGroupCenters([2678], CIRCLE_OPTS);
  const cy = CIRCLE_OPTS.height / 2;
  const outerBound = Math.min(CIRCLE_OPTS.width, CIRCLE_OPTS.height) / 2 - CIRCLE_OPTS.r;

  for (const order of CIRCLE_ORDERS) {
    const dots = packCircle(items, CIRCLE_OPTS, order);
    const radii = dots.map((d) => Math.hypot(d.x - cx, d.y - cy));
    const minR = Math.min(...radii);
    const maxR = Math.max(...radii);
    assert.ok(maxR <= outerBound + 0.5, `order=${order}: dot strays outside plot box, maxR=${maxR.toFixed(1)}`);
    assert.ok(
      minR / maxR > 0.35,
      `order=${order}: no clear center hole — minR/maxR = ${(minR / maxR).toFixed(2)}`,
    );
  }
});

test("packCircle's bounding box reads as a circle, not an oval", () => {
  const items = makeItems([2678]);
  const dots = packCircle(items, CIRCLE_OPTS, "input");
  const xs = dots.map((d) => d.x);
  const ys = dots.map((d) => d.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  assert.ok(Math.abs(width / height - 1) < 0.05, `bounding box is ${width.toFixed(0)}x${height.toFixed(0)}, expected ~square`);
});

test("packCircle is deterministic: identical input produces byte-identical output, for every order", () => {
  const items = makeItems([2678]);
  for (const order of CIRCLE_ORDERS) {
    const a = packCircle(items, CIRCLE_OPTS, order);
    const b = packCircle(items, CIRCLE_OPTS, order);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
});

test("packCircle's three orders all place dots at the exact same set of positions", () => {
  // This is the invariant packCircle's no-overlap guarantee relies on
  // carrying over to every order: order only changes which respondent gets
  // which position, never the position set itself.
  const items = makeItems([900, 900, 878]);
  const opts = { ...CIRCLE_OPTS, groups: 3 };
  const asSortedPoints = (order: CircleOrder) =>
    packCircle(items, opts, order)
      .map((d) => `${d.x.toFixed(4)}:${d.y.toFixed(4)}`)
      .sort();

  const input = asSortedPoints("input");
  assert.deepEqual(asSortedPoints("radial"), input);
  assert.deepEqual(asSortedPoints("angular"), input);
});

test("packCircle 'radial' order lays out each group as a contiguous, non-overlapping radial band", () => {
  const counts = [500, 800, 1378];
  const items = makeItems(counts);
  const opts = { ...CIRCLE_OPTS, groups: counts.length };
  const [cx] = computeGroupCenters([items.length], CIRCLE_OPTS);
  const cy = CIRCLE_OPTS.height / 2;

  const dots = packCircle(items, opts, "radial");
  const radiiByGroup = new Map<number, number[]>();
  items.forEach((item, i) => {
    const list = radiiByGroup.get(item.group) ?? [];
    list.push(Math.hypot(dots[i].x - cx, dots[i].y - cy));
    radiiByGroup.set(item.group, list);
  });

  const bands = [...radiiByGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, radii]) => [Math.min(...radii), Math.max(...radii)] as const);

  for (let g = 0; g < bands.length - 1; g++) {
    assert.ok(
      bands[g][1] <= bands[g + 1][0] + 0.01,
      `group ${g}'s radial band ${bands[g][0].toFixed(1)}-${bands[g][1].toFixed(1)} overlaps group ${g + 1}'s ${bands[g + 1][0].toFixed(1)}-${bands[g + 1][1].toFixed(1)}`,
    );
  }
});

test("packCircle 'angular' order lays out each group as one contiguous wedge", () => {
  const counts = [500, 800, 1378];
  const items = makeItems(counts);
  const opts = { ...CIRCLE_OPTS, groups: counts.length };
  const [cx] = computeGroupCenters([items.length], CIRCLE_OPTS);
  const cy = CIRCLE_OPTS.height / 2;

  const dots = packCircle(items, opts, "angular");
  const anglesByGroup = new Map<number, number[]>();
  items.forEach((item, i) => {
    const theta = (Math.atan2(dots[i].y - cy, dots[i].x - cx) + 2 * Math.PI) % (2 * Math.PI);
    const list = anglesByGroup.get(item.group) ?? [];
    list.push(theta);
    anglesByGroup.set(item.group, list);
  });

  const wedges = [...anglesByGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, angles]) => [Math.min(...angles), Math.max(...angles)] as const);

  for (let g = 0; g < wedges.length - 1; g++) {
    assert.ok(
      wedges[g][1] <= wedges[g + 1][0] + 1e-9,
      `group ${g}'s wedge overlaps group ${g + 1}'s`,
    );
  }
});

function pointKey(p: { x: number; y: number }): string {
  return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
}

test("clusterMatched preserves the exact multiset of coordinates", () => {
  const items = makeItems([10, 6, 4]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 3 === 0);

  const out = clusterMatched(dots, groupOf, matched);

  assert.deepEqual(out.map(pointKey).sort(), dots.map(pointKey).sort());
});

test("clusterMatched preserves respondent ids in array order", () => {
  const items = makeItems([10, 6, 4]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 2 === 0);

  const out = clusterMatched(dots, groupOf, matched);

  out.forEach((d, i) => assert.equal(d.id, dots[i].id));
});

test("clusterMatched never moves a dot's coordinates to a different group", () => {
  const items = makeItems([10, 6, 4]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 2 === 0);

  const out = clusterMatched(dots, groupOf, matched);

  const inByGroup = byGroup(items, dots);
  const outByGroup = byGroup(items, out);
  for (const [group, inPoints] of inByGroup) {
    const outPoints = outByGroup.get(group) ?? [];
    assert.deepEqual(outPoints.map(pointKey).sort(), inPoints.map(pointKey).sort());
  }
});

test("clusterMatched puts every matched dot at least as close to its group's centroid as every unmatched dot", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 4 === 0);

  const out = clusterMatched(dots, groupOf, matched);

  const dist = (p: PositionedDot, c: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y);

  for (const group of new Set(groupOf)) {
    const groupDots = out.filter((_, i) => groupOf[i] === group);
    const cx = groupDots.reduce((s, p) => s + p.x, 0) / groupDots.length;
    const cy = groupDots.reduce((s, p) => s + p.y, 0) / groupDots.length;
    const centroid = { x: cx, y: cy };

    const matchedDist = out.filter((_, i) => groupOf[i] === group && matched[i]).map((p) => dist(p, centroid));
    const unmatchedDist = out.filter((_, i) => groupOf[i] === group && !matched[i]).map((p) => dist(p, centroid));
    if (matchedDist.length === 0 || unmatchedDist.length === 0) continue;

    const worstMatched = Math.max(...matchedDist);
    const bestUnmatched = Math.min(...unmatchedDist);
    assert.ok(
      worstMatched <= bestUnmatched + 1e-9,
      `group ${group}: a matched dot (${worstMatched.toFixed(3)}px from centroid) sits farther out than an unmatched dot (${bestUnmatched.toFixed(3)}px)`,
    );
  }
});

test("clusterMatched is idempotent — clustering an already-clustered arrangement is a no-op", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 3 === 0);

  const once = clusterMatched(dots, groupOf, matched);
  const twice = clusterMatched(once, groupOf, matched);

  assert.deepEqual(twice, once);
});

test("clusterMatched is deterministic, including on a symmetric hex shell with tied distances", () => {
  // n=7 is small enough that packHexPoints' outer shell has several
  // candidates equidistant from the lattice origin — exactly the tie the
  // theta tiebreak exists to resolve consistently.
  const items = makeItems([7]);
  const dots = packSwarm(items, { ...OPTS, groups: 1 });
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 2 === 0);

  const first = clusterMatched(dots, groupOf, matched);
  const second = clusterMatched(dots, groupOf, matched);

  assert.deepEqual(second, first);
});

test("clusterMatched returns dots unchanged when the input arrays' lengths disagree", () => {
  const items = makeItems([3, 2]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const matched = items.map((_, i) => i % 2 === 0);

  assert.equal(clusterMatched(dots, groupOf.slice(0, -1), matched), dots);
  assert.equal(clusterMatched(dots, groupOf, matched.slice(0, -1)), dots);
});

function distancesFromGroupCentroids(dots: PositionedDot[], groupOf: number[]): number[] {
  const centroids = new Map<number, { x: number; y: number }>();
  for (const g of new Set(groupOf)) {
    const members = dots.filter((_, i) => groupOf[i] === g);
    const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
    const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
    centroids.set(g, { x: cx, y: cy });
  }
  return dots.map((d, i) => {
    const c = centroids.get(groupOf[i])!;
    return Math.hypot(d.x - c.x, d.y - c.y);
  });
}

test("clusterByRank orders each group by (rank, original index) ascending, nearest-centroid first", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  // 4 ranks (0-3), not just a boolean, to exercise a genuinely multi-tier order.
  const rankOf = items.map((_, i) => i % 4);

  const out = clusterByRank(dots, groupOf, rankOf);
  const dist = distancesFromGroupCentroids(out, groupOf);

  for (const g of new Set(groupOf)) {
    const members = groupOf.map((gg, i) => (gg === g ? i : -1)).filter((i) => i !== -1);
    for (const i of members) {
      for (const j of members) {
        const iBeforeJ = rankOf[i] < rankOf[j] || (rankOf[i] === rankOf[j] && i < j);
        if (iBeforeJ) {
          assert.ok(
            dist[i] <= dist[j] + 1e-9,
            `group ${g}: rank/index-earlier dot ${i} (dist ${dist[i].toFixed(3)}) sits farther out than later dot ${j} (dist ${dist[j].toFixed(3)})`,
          );
        }
      }
    }
  }
});

test("clusterByRank composes a nested order — a coarse tier dominates a finer sub-rank within it", () => {
  // Mirrors the "theme match (tier) + stance (category)" composition: tier
  // 0 (e.g. matched) must end up entirely inside tier 1 (unmatched),
  // regardless of each dot's own category sub-rank.
  const items = makeItems([60, 30]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const NUM_CATEGORIES = 5;
  const categoryOf = items.map((_, i) => i % NUM_CATEGORIES);
  const tierOf = items.map((_, i) => (i % 3 === 0 ? 0 : 1)); // 0 = inner tier
  const rankOf = items.map((_, i) => tierOf[i] * NUM_CATEGORIES + categoryOf[i]);

  const out = clusterByRank(dots, groupOf, rankOf);
  const dist = distancesFromGroupCentroids(out, groupOf);

  for (const g of new Set(groupOf)) {
    const innerDist = dist.filter((_, i) => groupOf[i] === g && tierOf[i] === 0);
    const outerDist = dist.filter((_, i) => groupOf[i] === g && tierOf[i] === 1);
    if (innerDist.length === 0 || outerDist.length === 0) continue;
    assert.ok(
      Math.max(...innerDist) <= Math.min(...outerDist) + 1e-9,
      `group ${g}: an inner-tier dot sits farther out than an outer-tier dot despite the tier split`,
    );
  }
});

test("clusterByRank preserves the exact multiset of coordinates and never crosses groups", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const rankOf = items.map((_, i) => i % 5);

  const out = clusterByRank(dots, groupOf, rankOf);

  assert.deepEqual(out.map(pointKey).sort(), dots.map(pointKey).sort());
  const inByGroup = byGroup(items, dots);
  const outByGroup = byGroup(items, out);
  for (const [group, inPoints] of inByGroup) {
    const outPoints = outByGroup.get(group) ?? [];
    assert.deepEqual(outPoints.map(pointKey).sort(), inPoints.map(pointKey).sort());
  }
  out.forEach((d, i) => assert.equal(d.id, dots[i].id));
});

test("clusterByRank is deterministic and idempotent", () => {
  const items = makeItems([40, 25, 10]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const rankOf = items.map((_, i) => i % 5);

  const first = clusterByRank(dots, groupOf, rankOf);
  const second = clusterByRank(dots, groupOf, rankOf);
  assert.deepEqual(second, first);

  const twice = clusterByRank(first, groupOf, rankOf);
  assert.deepEqual(twice, first);
});

test("clusterByRank returns dots unchanged when the input arrays' lengths disagree", () => {
  const items = makeItems([3, 2]);
  const dots = packSwarm(items, OPTS);
  const groupOf = items.map((it) => it.group);
  const rankOf = items.map((_, i) => i % 3);

  assert.equal(clusterByRank(dots, groupOf.slice(0, -1), rankOf), dots);
  assert.equal(clusterByRank(dots, groupOf, rankOf.slice(0, -1)), dots);
});
