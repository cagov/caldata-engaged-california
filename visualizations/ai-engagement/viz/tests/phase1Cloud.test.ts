import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhase1Cloud, childProgress, computeAbsorption, wrapTwoLines, SPAN } from "../src/lib/phase1Cloud.ts";
import { PHASE1_CONCEPTS } from "../src/lib/phase1ConceptsData.ts";

test("buildPhase1Cloud places all 27 parents and 126 children", () => {
  const layout = buildPhase1Cloud();
  assert.equal(layout.parents.length, 27);
  const totalChildren = PHASE1_CONCEPTS.reduce((a, c) => a + c.from.length, 0);
  assert.equal(layout.children.length, totalChildren);
  assert.equal(layout.children.length, 126);
});

test("buildPhase1Cloud is deterministic across calls", () => {
  const a = buildPhase1Cloud();
  const b = buildPhase1Cloud();
  assert.deepEqual(a, b);
});

test("every placed item gets a finite home position and at least one line", () => {
  const layout = buildPhase1Cloud();
  for (const item of [...layout.parents, ...layout.children]) {
    assert.ok(Number.isFinite(item.home[0]) && Number.isFinite(item.home[1]));
    assert.ok(item.lines.length >= 1);
    assert.ok(item.refFS > 0);
  }
});

test("childProgress is 0 before a child's delay and eases to 1 by delay + SPAN", () => {
  assert.equal(childProgress(0.2, 0), 0);
  assert.equal(childProgress(0.2, 0.2), 0);
  assert.equal(childProgress(0.2, 0.2 + SPAN), 1);
  assert.equal(childProgress(0.2, 1), 1);
});

test("computeAbsorption is all zero at p=0", () => {
  const layout = buildPhase1Cloud();
  const acc = computeAbsorption(layout, 0);
  assert.ok(acc.every((v) => v === 0));
});

test("computeAbsorption fully absorbs every parent's children by p=1", () => {
  const layout = buildPhase1Cloud();
  const acc = computeAbsorption(layout, 1);
  layout.parents.forEach((parent, i) => {
    assert.equal(acc[i], parent.total);
  });
});

test("wrapTwoLines keeps short labels on one line", () => {
  assert.deepEqual(wrapTwoLines("Privacy", 14), ["Privacy"]);
});

test("wrapTwoLines splits a long sentence into exactly two lines, preserving all words", () => {
  const lines = wrapTwoLines("Hold AI companies liable for harm they cause", 14);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(" "), "Hold AI companies liable for harm they cause");
});

test("wrapTwoLines never splits a single word", () => {
  assert.deepEqual(wrapTwoLines("Supercalifragilisticexpialidocious", 14), ["Supercalifragilisticexpialidocious"]);
});

test("buildPhase1Cloud places every child and every parent at a distinct position — a packing failure would silently stack multiple items at the same fallback point", () => {
  const layout = buildPhase1Cloud();
  const childKeys = layout.children.map((c) => `${c.home[0].toFixed(3)},${c.home[1].toFixed(3)}`);
  const parentKeys = layout.parents.map((p) => `${p.home[0].toFixed(3)},${p.home[1].toFixed(3)}`);
  assert.equal(new Set(childKeys).size, childKeys.length, "two or more children share an identical home position — a packing failure");
  assert.equal(new Set(parentKeys).size, parentKeys.length, "two or more parents share an identical home position — a packing failure");
});
