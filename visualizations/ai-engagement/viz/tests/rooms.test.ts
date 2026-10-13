import { test } from "node:test";
import assert from "node:assert/strict";
import { roomRing, ringPositions, TOP_ANGLE, type Point } from "../src/lib/rooms.ts";

function minPairDist(points: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return min;
}

test("roomRing(14, roomRadius=46, gap=14) reproduces the brief's R ~ 236", () => {
  const { ringRadius } = roomRing(14, { roomRadius: 46, gap: 14 });
  assert.ok(Math.abs(ringRadius - 236) < 1, `ringRadius ${ringRadius.toFixed(2)}, want ~236`);
});

test("roomRing's 14 room centers never overlap (no pair closer than 2*roomRadius)", () => {
  const roomRadius = 46;
  const { centers } = roomRing(14, { roomRadius, gap: 14 });
  assert.equal(centers.length, 14);

  const min = minPairDist(centers);
  assert.ok(
    min >= 2 * roomRadius,
    `nearest pair of room centers is ${min.toFixed(2)}px apart, want >= ${2 * roomRadius} (2*roomRadius)`,
  );
});

test("roomRing derives R from count/roomRadius/gap, not a hard-coded constant", () => {
  // Doubling the gap (holding count and roomRadius fixed) must grow the
  // ring — otherwise the formula isn't actually being used.
  const tight = roomRing(14, { roomRadius: 46, gap: 14 });
  const loose = roomRing(14, { roomRadius: 46, gap: 28 });
  assert.ok(loose.ringRadius > tight.ringRadius);

  // And the formula itself, spelled out, should match what roomRing returns.
  const expected = (14 * (2 * 46 + 14)) / (2 * Math.PI);
  assert.ok(Math.abs(tight.ringRadius - expected) < 1e-9);
});

test("roomRing's centerFreeRadius matches the brief's ~380px center hole (diameter), derived not hard-coded", () => {
  const { ringRadius, roomRadius, centerFreeRadius } = roomRing(14, { roomRadius: 46, gap: 14 });

  // centerFreeRadius must be exactly ringRadius - roomRadius: the distance
  // from the ring's center out to the nearest edge of any room's circle.
  assert.ok(Math.abs(centerFreeRadius - (ringRadius - roomRadius)) < 1e-9);

  const holeDiameter = 2 * centerFreeRadius;
  assert.ok(Math.abs(holeDiameter - 380) < 5, `hole diameter ${holeDiameter.toFixed(1)}px, want ~380`);
});

test("roomRing's headlineRadius floor grows the ring when the formula alone would leave less center space", () => {
  const { roomRadius, ringRadius: bare, centerFreeRadius: bareFree } = roomRing(14, { roomRadius: 46, gap: 14 });

  // Ask for more center space than the bare formula gives (bareFree ~ 190).
  const wide = roomRing(14, { roomRadius: 46, gap: 14, headlineRadius: 250 });
  assert.ok(wide.ringRadius > bare, "ring should grow to make room for the requested headline radius");
  assert.ok(wide.centerFreeRadius >= 250 - 1e-9, `centerFreeRadius ${wide.centerFreeRadius}, want >= 250`);

  // Asking for less than the bare formula already provides is a no-op.
  const narrow = roomRing(14, { roomRadius: 46, gap: 14, headlineRadius: 10 });
  assert.ok(Math.abs(narrow.ringRadius - bare) < 1e-9);
  assert.ok(Math.abs(narrow.centerFreeRadius - bareFree) < 1e-9);
});

test("roomRing(1, ...) does not divide by zero or produce NaN", () => {
  const result = roomRing(1, { roomRadius: 46, gap: 14 });
  assert.equal(result.centers.length, 1);
  assert.ok(Number.isFinite(result.ringRadius));
  assert.ok(Number.isFinite(result.centerFreeRadius));
  assert.ok(Number.isFinite(result.centers[0].x));
  assert.ok(Number.isFinite(result.centers[0].y));
});

test("roomRing(0, ...) returns an empty ring, not NaN", () => {
  const result = roomRing(0, { roomRadius: 46, gap: 14 });
  assert.deepEqual(result.centers, []);
  assert.equal(result.ringRadius, 0);
  assert.ok(Number.isFinite(result.ringRadius));
});

test("ringPositions returns n points evenly spaced 2*PI/n apart", () => {
  const center = { x: 0, y: 0 };
  const radius = 100;
  const n = 8;
  const points = ringPositions(center, radius, n);
  assert.equal(points.length, n);

  // Every point should sit exactly on the circle.
  for (const p of points) {
    const r = Math.hypot(p.x - center.x, p.y - center.y);
    assert.ok(Math.abs(r - radius) < 1e-9, `point (${p.x}, ${p.y}) is ${r}px from center, want ${radius}`);
  }

  // Adjacent points should be separated by exactly the same chord length —
  // "evenly spaced" means the angular step is constant, not just that all
  // points lie on the circle.
  const chord = 2 * radius * Math.sin(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const next = points[(i + 1) % n];
    const dist = Math.hypot(points[i].x - next.x, points[i].y - next.y);
    assert.ok(Math.abs(dist - chord) < 1e-9, `chord ${i}->${i + 1} is ${dist}, want ${chord}`);
  }
});

test("ringPositions: 12 dots at r=3 on an inner ring of radius ~30 stay clear of each other", () => {
  // The brief's inner-ring worked example: 12 dots on a ~188px circumference
  // gives ~15.7px spacing between adjacent dots (well clear of 2*r=6).
  const points = ringPositions({ x: 0, y: 0 }, 30, 12);
  const min = minPairDist(points);
  assert.ok(min > 14 && min < 17, `min pairwise spacing ${min.toFixed(2)}px, want in the ~14-17px neighborhood`);
});

test("ringPositions(center, radius, 1, ...) does not divide by zero or produce NaN", () => {
  const points = ringPositions({ x: 5, y: 5 }, 30, 1);
  assert.equal(points.length, 1);
  assert.ok(Number.isFinite(points[0].x));
  assert.ok(Number.isFinite(points[0].y));
});

test("ringPositions(center, radius, 0, ...) returns an empty array, not NaN", () => {
  const points = ringPositions({ x: 0, y: 0 }, 30, 0);
  assert.deepEqual(points, []);
});

test("12 o'clock convention: point 0 sits at the top (cx, cy - r)", () => {
  const center = { x: 50, y: 50 };
  const radius = 20;
  const [p0] = ringPositions(center, radius, 12);
  assert.ok(Math.abs(p0.x - center.x) < 1e-9, `p0.x ${p0.x}, want ${center.x}`);
  assert.ok(Math.abs(p0.y - (center.y - radius)) < 1e-9, `p0.y ${p0.y}, want ${center.y - radius}`);
});

test("clockwise convention: point 1 moves right and down from point 0's 12-o'clock start, as rendered in y-down SVG coords", () => {
  // n=12 keeps the angular step small, so this reads as "a small clockwise
  // step from 12 o'clock" rather than jumping straight to 3 o'clock.
  const center = { x: 0, y: 0 };
  const radius = 100;
  const points = ringPositions(center, radius, 12);
  const [p0, p1] = points;

  assert.ok(Math.abs(p0.x - center.x) < 1e-9 && Math.abs(p0.y - (center.y - radius)) < 1e-9, "p0 is at 12 o'clock");
  // Moving clockwise from 12 o'clock (as drawn on screen, y increasing
  // downward) means moving toward 1 o'clock: rightward (x increases) and
  // downward (y increases, since SVG y grows down) — never leftward or up.
  assert.ok(p1.x > p0.x, `p1.x (${p1.x.toFixed(3)}) should be greater than p0.x (${p0.x.toFixed(3)})`);
  assert.ok(p1.y > p0.y, `p1.y (${p1.y.toFixed(3)}) should be greater than p0.y (${p0.y.toFixed(3)})`);
});

test("roomRing and ringPositions agree: roomRing's centers are exactly ringPositions at its own ringRadius, starting at TOP_ANGLE", () => {
  const roomRadius = 46;
  const gap = 14;
  const count = 6;
  const { centers, ringRadius } = roomRing(count, { roomRadius, gap });
  const expected = ringPositions({ x: 0, y: 0 }, ringRadius, count, TOP_ANGLE);

  assert.equal(centers.length, expected.length);
  centers.forEach((c, i) => {
    assert.ok(Math.abs(c.x - expected[i].x) < 1e-9);
    assert.ok(Math.abs(c.y - expected[i].y) < 1e-9);
  });
});

test("ringPositions is deterministic: identical input produces byte-identical output", () => {
  const a = ringPositions({ x: 12, y: 34 }, 56, 9, 0.3);
  const b = ringPositions({ x: 12, y: 34 }, 56, 9, 0.3);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("ringPositions honors a custom startAngle", () => {
  const center = { x: 0, y: 0 };
  const radius = 10;
  const [p0] = ringPositions(center, radius, 4, 0);
  // startAngle=0 means theta=0: (cx + r, cy).
  assert.ok(Math.abs(p0.x - radius) < 1e-9);
  assert.ok(Math.abs(p0.y - 0) < 1e-9);
});
