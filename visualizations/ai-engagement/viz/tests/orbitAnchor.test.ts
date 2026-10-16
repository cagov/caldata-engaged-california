import { test } from "node:test";
import assert from "node:assert/strict";
import { ringPositions } from "../src/lib/rooms.ts";
import { orbitAnchorRadius, circleBBox, unionBBox, bboxCenter, type BBox } from "../src/lib/orbitAnchor.ts";

const DOT_R = 3;
const INNER_RADIUS = 30;

// The real attendee counts from the workbook's `lookup` sheet (5, 6, 7, 8,
// 11, 12 — see the internal analysis notes), covering every parity actually rendered:
// 5 is both odd and the most common count in the real data.
const REAL_ATTENDEE_COUNTS = [5, 6, 7, 8, 11, 12];

test("without an anchor, odd attendee counts genuinely orbit off-center — this is the bug the anchor fixes", () => {
  const center = { x: 0, y: 0 };
  for (const n of [5, 7, 11]) {
    const dots = ringPositions(center, INNER_RADIUS, n);
    const aggregate = dots
      .map((dot) => circleBBox(dot.x, dot.y, DOT_R))
      .reduce((acc, box) => (acc ? unionBBox(acc, box) : box), null as BBox | null)!;
    const c = bboxCenter(aggregate);
    const offCenter = Math.abs(c.x - center.x) > 0.1 || Math.abs(c.y - center.y) > 0.1;
    assert.ok(offCenter, `n=${n}: expected the dots-only bbox to be measurably off-center (that's the bug)`);
  }
});

test("even attendee counts happen to center correctly even without the anchor (why the bug was easy to miss)", () => {
  const center = { x: 0, y: 0 };
  for (const n of [6, 8, 12]) {
    const dots = ringPositions(center, INNER_RADIUS, n);
    const aggregate = dots
      .map((dot) => circleBBox(dot.x, dot.y, DOT_R))
      .reduce((acc, box) => (acc ? unionBBox(acc, box) : box), null as BBox | null)!;
    const c = bboxCenter(aggregate);
    assert.ok(Math.abs(c.x - center.x) < 1e-9 && Math.abs(c.y - center.y) < 1e-9, `n=${n}: expected exact centering`);
  }
});

test("the orbit anchor's bbox fully contains every attendee dot's bbox, for every real attendee count", () => {
  const anchorR = orbitAnchorRadius(INNER_RADIUS, DOT_R);
  const center = { x: 123, y: -45 }; // an arbitrary, non-origin room center
  const anchor = circleBBox(center.x, center.y, anchorR);

  for (const n of REAL_ATTENDEE_COUNTS) {
    const dots = ringPositions(center, INNER_RADIUS, n);
    for (const dot of dots) {
      const dotBox = circleBBox(dot.x, dot.y, DOT_R);
      assert.ok(dotBox.minX >= anchor.minX && dotBox.maxX <= anchor.maxX, `n=${n}: dot x-extent escapes the anchor`);
      assert.ok(dotBox.minY >= anchor.minY && dotBox.maxY <= anchor.maxY, `n=${n}: dot y-extent escapes the anchor`);
    }
  }
});

test("with the anchor included, the orbit group's aggregate bbox is centered exactly on the room center — for every real attendee count, including odd ones", () => {
  const anchorR = orbitAnchorRadius(INNER_RADIUS, DOT_R);
  const center = { x: 7, y: 19 };

  for (const n of REAL_ATTENDEE_COUNTS) {
    const dots = ringPositions(center, INNER_RADIUS, n);
    const anchor = circleBBox(center.x, center.y, anchorR);
    const aggregate = dots.reduce((acc, dot) => unionBBox(acc, circleBBox(dot.x, dot.y, DOT_R)), anchor);
    const c = bboxCenter(aggregate);
    assert.ok(Math.abs(c.x - center.x) < 1e-9, `n=${n}: bbox center x ${c.x} != room center x ${center.x}`);
    assert.ok(Math.abs(c.y - center.y) < 1e-9, `n=${n}: bbox center y ${c.y} != room center y ${center.y}`);
  }
});

test("orbitAnchorRadius is just innerRadius + dotR", () => {
  assert.equal(orbitAnchorRadius(30, 3), 33);
  assert.equal(orbitAnchorRadius(0, 5), 5);
});
