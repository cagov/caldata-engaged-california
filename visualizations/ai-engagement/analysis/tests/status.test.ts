import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicStatus } from "../src/lib/status.ts";

test("status rules", () => {
  assert.equal(deterministicStatus(""), "blank");
  assert.equal(deterministicStatus("   "), "blank");
  assert.equal(deterministicStatus("I don't want to say"), "refused");
  assert.equal(deterministicStatus("x".repeat(61)), "substantive");
  // The load-bearing cases: terse but potentially substantive → judged, not discarded
  assert.equal(deterministicStatus("nothing"), "needs_judgment");
  assert.equal(deterministicStatus("Negatively."), "needs_judgment");
  assert.equal(deterministicStatus("yes"), "needs_judgment");
  assert.equal(deterministicStatus("n/a"), "needs_judgment");
});
