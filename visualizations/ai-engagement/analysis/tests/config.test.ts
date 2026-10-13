import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, PIPELINE_MODEL, SEGMENTS } from "../src/config.ts";

test("three questions with exact instrument wording", () => {
  assert.equal(QUESTIONS.length, 3);
  const byId = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.prompt]));
  assert.equal(byId.personal, "How has AI impacted your job and workplace, if at all?");
  assert.equal(byId.economy, "How do you expect AI to impact the economy?");
  assert.equal(byId.government, "What do you think the government should do about these impacts?");
});

test("model is pinned", () => {
  assert.equal(PIPELINE_MODEL, "claude-opus-5");
});

test("segments include the role and field breakdowns", () => {
  assert.ok((SEGMENTS as readonly string[]).includes("ROLE_AT_WORK"));
  assert.ok((SEGMENTS as readonly string[]).includes("FIELD_OF_WORK"));
});
