import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASE1_THEMES, PHASE1_SUBTHEMES, PHASE1_CONCEPTS } from "../src/lib/phase1ConceptsData.ts";

test("PHASE1_THEMES has exactly 3 themes", () => {
  assert.equal(PHASE1_THEMES.length, 3);
});

test("PHASE1_SUBTHEMES has exactly 8 subthemes, each pointing at a valid theme", () => {
  assert.equal(PHASE1_SUBTHEMES.length, 8);
  for (const s of PHASE1_SUBTHEMES) {
    assert.ok(s.theme >= 0 && s.theme < PHASE1_THEMES.length);
  }
});

test("PHASE1_CONCEPTS has exactly 27 concepts, each pointing at a valid subtheme", () => {
  assert.equal(PHASE1_CONCEPTS.length, 27);
  for (const c of PHASE1_CONCEPTS) {
    assert.ok(c.subtheme >= 0 && c.subtheme < PHASE1_SUBTHEMES.length);
  }
});

test("PHASE1_CONCEPTS' children total exactly 126, matching the sketch's own count", () => {
  const total = PHASE1_CONCEPTS.reduce((a, c) => a + c.from.length, 0);
  assert.equal(total, 126);
});

test("every subtheme is used by at least one concept", () => {
  const used = new Set(PHASE1_CONCEPTS.map((c) => c.subtheme));
  assert.equal(used.size, PHASE1_SUBTHEMES.length);
});
