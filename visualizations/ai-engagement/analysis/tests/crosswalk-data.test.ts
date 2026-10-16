import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const crosswalk = JSON.parse(readFileSync("config/phase-crosswalk.json", "utf-8"));

test("crosswalk has exactly one entry per Phase 2 concept, C-01 through C-29", () => {
  const ids = crosswalk.concepts.map((c: { conceptId: string }) => c.conceptId).sort();
  const expected = Array.from({ length: 29 }, (_, i) => `C-${String(i + 1).padStart(2, "0")}`).sort();
  assert.deepEqual(ids, expected);
});

test("every source has a non-empty rationale and a valid strength", () => {
  const validStrengths = new Set(["primary", "secondary", "tangential"]);
  for (const concept of crosswalk.concepts) {
    assert.ok(concept.sources.length > 0, `${concept.conceptId} has no sources`);
    for (const source of concept.sources) {
      assert.ok(source.rationale.trim().length > 0, `${concept.conceptId}/${source.code} has an empty rationale`);
      assert.ok(validStrengths.has(source.strength), `${concept.conceptId}/${source.code} has bad strength ${source.strength}`);
      assert.ok(["personal", "economy", "government"].includes(source.field), `${concept.conceptId}/${source.code} has bad field ${source.field}`);
    }
  }
});

test("crosswalk status is a valid state, and approval implies an approver", () => {
  assert.ok(["proposed", "approved"].includes(crosswalk.status), `unexpected status ${crosswalk.status}`);
  if (crosswalk.status === "approved") {
    assert.ok(crosswalk.approvedBy, "an approved crosswalk must record who approved it");
  }
});
