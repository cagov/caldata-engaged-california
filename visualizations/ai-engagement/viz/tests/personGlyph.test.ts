import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSON_BOX, PERSON_SCALE, personHeightFor, personWidthFor } from "../src/lib/personGlyph.ts";

test("PERSON_BOX is centered inside the glyph's 1200x1200 viewBox", () => {
  assert.equal(PERSON_BOX.cx, 600);
  assert.equal(PERSON_BOX.cy, 600);
  assert.ok(PERSON_BOX.x >= 0 && PERSON_BOX.x + PERSON_BOX.w <= 1200);
  assert.ok(PERSON_BOX.y >= 0 && PERSON_BOX.y + PERSON_BOX.h <= 1200);
});

test("personHeightFor scales a dot radius up by PERSON_SCALE times its diameter", () => {
  assert.equal(personHeightFor(6), PERSON_SCALE * 12);
  assert.equal(personHeightFor(7), PERSON_SCALE * 14);
});

test("personWidthFor preserves the glyph's own aspect ratio at any size", () => {
  const h = personHeightFor(6);
  const w = personWidthFor(6);
  assert.equal(w / h, PERSON_BOX.w / PERSON_BOX.h);
});
