import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, parseJudgeResult } from "../src/lib/judge.ts";

test("prompt contains the actual question and the answer", () => {
  const p = buildJudgePrompt("What do you think the government should do about these impacts?", "nothing");
  assert.ok(p.includes("government should do"));
  assert.ok(p.includes('"nothing"'));
  assert.ok(p.toLowerCase().includes("however brief"));
});

test("parse accepts the schema shape and rejects junk", () => {
  assert.deepEqual(parseJudgeResult('{"substantive":true,"reason":"states a position"}'), {
    substantive: true,
    reason: "states a position",
  });
  assert.throws(() => parseJudgeResult('{"substantive":"yes"}'));
});
