import { test } from "node:test";
import assert from "node:assert/strict";
import { taperedRadialBranch, bundlePath } from "../src/lib/branch.ts";
import type { Point } from "../src/lib/rooms.ts";

function parsePathCommands(d: string): string[] {
  return d.match(/[MLCZ]/g) ?? [];
}

test("taperedRadialBranch returns a closed path (M...C...L...C...Z)", () => {
  const from: Point = { x: 0, y: 0 };
  const to: Point = { x: 100, y: 0 };
  const d = taperedRadialBranch(from, to, 10, 4);
  assert.equal(d[0], "M");
  assert.ok(d.trim().endsWith("Z"));
  const commands = parsePathCommands(d);
  assert.deepEqual(commands, ["M", "C", "L", "C", "Z"]);
});

test("taperedRadialBranch is wider at `from` than `to` when w0 > w1", () => {
  // Geometry is fully deterministic for a horizontal branch, so assert the
  // exact emitted path rather than a loose shape check. For from=(0,0),
  // to=(100,0): normal = {x: -dy/len, y: dx/len} = {x: 0, y: 1}. With
  // w0=20, w1=2: fromA=(0,10), fromB=(0,-10), toA=(100,1), toB=(100,-1),
  // midA=(50,5.5), midB=(50,-5.5) — worked out by hand from
  // taperedRadialBranch's own formula (see its implementation comment).
  const from: Point = { x: 0, y: 0 };
  const to: Point = { x: 100, y: 0 };
  const d = taperedRadialBranch(from, to, 20, 2);
  assert.equal(d, "M 0 10 C 50 5.5 50 5.5 100 1 L 100 -1 C 50 -5.5 50 -5.5 0 -10 Z");

  // Restated as an explicit width check (not just string equality) so a
  // future change to path formatting doesn't silently stop verifying the
  // one property this test exists to check: the taper itself.
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // Numbers appear in path order: M(fromA) C control1 control2 (toA) L(toB) C control1 control2 (fromB) Z
  // i.e. indices [0,1]=fromA, [6,7]=toA (the first C's endpoint), [8,9]=toB
  // (the L command's endpoint), [len-2,len-1]=fromB (the second C's endpoint).
  const fromA: Point = { x: nums[0], y: nums[1] };
  const toA: Point = { x: nums[6], y: nums[7] };
  const toB: Point = { x: nums[8], y: nums[9] };
  const fromB: Point = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
  const widthAtFrom = Math.hypot(fromA.x - fromB.x, fromA.y - fromB.y);
  const widthAtTo = Math.hypot(toA.x - toB.x, toA.y - toB.y);
  assert.ok(Math.abs(widthAtFrom - 20) < 1e-6, `width at 'from' is ${widthAtFrom}, want 20`);
  assert.ok(Math.abs(widthAtTo - 2) < 1e-6, `width at 'to' is ${widthAtTo}, want 2`);
  assert.ok(widthAtFrom > widthAtTo, "the branch must actually taper");
});

test("taperedRadialBranch offsets are perpendicular to the from->to direction", () => {
  // For a horizontal branch (from -> to along +x), the perpendicular is
  // vertical, so the start point M and the mirrored end of the path should
  // differ only in y by ~w0, with x approx equal to from.x.
  const from: Point = { x: 0, y: 0 };
  const to: Point = { x: 50, y: 0 };
  const w0 = 8;
  const d = taperedRadialBranch(from, to, w0, w0);
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const mx = nums[0];
  const my = nums[1];
  assert.ok(Math.abs(mx - from.x) < 1e-6, `M.x ${mx} should equal from.x ${from.x} for a horizontal branch`);
  assert.ok(Math.abs(Math.abs(my) - w0 / 2) < 1e-6, `M.y ${my} should be +/- w0/2 (${w0 / 2})`);
});

test("bundlePath returns an open path (M...C) from leaf through a via point to target", () => {
  const leaf: Point = { x: 100, y: -100 };
  const via: Point = { x: 50, y: -50 };
  const target: Point = { x: 0, y: 0 };
  const d = bundlePath(leaf, via, target, 0.5);
  assert.equal(d[0], "M");
  assert.ok(d.includes("C"));
  assert.ok(!d.trim().endsWith("Z"), "a strand is a stroke, not a filled region");
});

test("bundlePath's curve control points move toward `via` as tension increases", () => {
  const leaf: Point = { x: 100, y: 0 };
  const via: Point = { x: 0, y: 100 };
  const target: Point = { x: -100, y: 0 };
  const loose = bundlePath(leaf, via, target, 0.1);
  const tight = bundlePath(leaf, via, target, 0.9);
  const numsLoose = loose.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const numsTight = tight.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // First control point (index 2,3 after the M x,y pair) should sit closer
  // to `via` at high tension than at low tension.
  const distLoose = Math.hypot(numsLoose[2] - via.x, numsLoose[3] - via.y);
  const distTight = Math.hypot(numsTight[2] - via.x, numsTight[3] - via.y);
  assert.ok(distTight < distLoose, `tight control point (dist ${distTight}) should be closer to via than loose (dist ${distLoose})`);
});
