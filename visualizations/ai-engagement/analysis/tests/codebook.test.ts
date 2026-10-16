import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCodebook } from "../src/lib/codebook.ts";

test("codebook loads, 112 themes, globally unique codes, real question text", () => {
  const cb = loadCodebook("config/codebook.json");
  const all = cb.questions.flatMap((q) => q.themes.map((t) => t.code));
  assert.equal(all.length, 112);
  assert.equal(new Set(all).size, all.length);
  assert.equal(
    cb.questions.find((q) => q.id === "personal")!.prompt,
    "How has AI impacted your job and workplace, if at all?",
  );
});
