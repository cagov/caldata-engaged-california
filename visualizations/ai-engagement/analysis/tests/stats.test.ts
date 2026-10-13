import { test } from "node:test";
import assert from "node:assert/strict";
import { wilson } from "../src/lib/stats.ts";

test("wilson interval for 3/400 spans roughly 0.3%–2.2%", () => {
  const { low, high } = wilson(3, 400);
  assert.ok(low > 0.002 && low < 0.004, `low=${low}`);
  assert.ok(high > 0.02 && high < 0.023, `high=${high}`);
});

test("wilson handles n=0 and stays in [0,1]", () => {
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
  const { low, high } = wilson(400, 400);
  assert.ok(low > 0.98 && high <= 1);
});
