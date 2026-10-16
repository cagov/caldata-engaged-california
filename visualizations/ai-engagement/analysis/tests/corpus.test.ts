import { test } from "node:test";
import assert from "node:assert/strict";
import { interleaveByStratum } from "../src/lib/corpus.ts";

test("round-robins strata", () => {
  const items = [
    { id: 1, s: "A" }, { id: 2, s: "A" }, { id: 3, s: "A" },
    { id: 4, s: "B" }, { id: 5, s: "B" }, { id: 6, s: "C" },
  ];
  const out = interleaveByStratum(items, (x) => x.s).map((x) => x.s);
  assert.deepEqual(out.slice(0, 3).sort(), ["A", "B", "C"]);
});
