import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayoutCache } from "../src/lib/layoutCache.ts";

test("calling get twice with the same key computes only once", async () => {
  const cache = createLayoutCache<number>();
  let calls = 0;
  const compute = () => {
    calls++;
    return Promise.resolve(42);
  };

  const a = await cache.get("region", compute);
  const b = await cache.get("region", compute);

  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(calls, 1);
});

test("different keys compute independently", async () => {
  const cache = createLayoutCache<string>();
  const a = await cache.get("region", () => Promise.resolve("region-result"));
  const b = await cache.get("age", () => Promise.resolve("age-result"));

  assert.equal(a, "region-result");
  assert.equal(b, "age-result");
});

test("concurrent gets for the same key share one in-flight computation", async () => {
  const cache = createLayoutCache<number>();
  let calls = 0;
  const compute = () =>
    new Promise<number>((resolve) => {
      calls++;
      setTimeout(() => resolve(7), 5);
    });

  const [a, b] = await Promise.all([cache.get("region", compute), cache.get("region", compute)]);

  assert.equal(a, 7);
  assert.equal(b, 7);
  assert.equal(calls, 1);
});

test("has() reflects whether a key has been requested", async () => {
  const cache = createLayoutCache<number>();
  assert.equal(cache.has("region"), false);
  await cache.get("region", () => Promise.resolve(1));
  assert.equal(cache.has("region"), true);
});
