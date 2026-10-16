import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClassifySystem,
  buildClassifyUser,
  validateLabels,
  LABELS_SCHEMA,
} from "../src/lib/classify.ts";
import type { Codebook } from "../src/lib/codebook.ts";

const FIXTURE_CODEBOOK: Codebook = {
  version: "test",
  questions: [
    {
      id: "personal",
      column: "PERSONAL_AI_IMPACT",
      prompt: "How has AI impacted your job and workplace, if at all?",
      themes: [
        { code: "JOB_LOST", label: "Already lost work", definition: "def", includes: ["a"], excludes: ["b"], examples: [] },
      ],
    },
    {
      id: "economy",
      column: "ECONOMIC_IMPACT_EXPECTATION",
      prompt: "How do you expect AI to impact the economy?",
      themes: [
        { code: "JOB_LOSS", label: "Job losses", definition: "def", includes: ["a"], excludes: ["b"], examples: [] },
        { code: "REGULATE", label: "Regulate", definition: "def", includes: ["a"], excludes: ["b"], examples: [] },
      ],
    },
  ],
};

test("buildClassifySystem includes every code with its home question labeled", () => {
  const system = buildClassifySystem(FIXTURE_CODEBOOK);
  assert.ok(system.includes("JOB_LOST"));
  assert.ok(system.includes("JOB_LOSS"));
  assert.ok(system.includes("REGULATE"));
  assert.ok(system.includes("personal"));
  assert.ok(system.includes("economy"));
});

test("buildClassifySystem states the multi-label and cross-field-bleed rules", () => {
  const system = buildClassifySystem(FIXTURE_CODEBOOK).toLowerCase();
  assert.ok(system.includes("multi-label") || system.includes("multiple"));
  assert.ok(system.includes("even if the respondent put it under a different question"));
  assert.ok(system.includes("empty labels list"));
  assert.ok(system.includes("only use codes from"));
});

test("buildClassifyUser renders each answer with its column, prompt, and text", () => {
  const user = buildClassifyUser([
    { column: "PERSONAL_AI_IMPACT", prompt: "How has AI impacted your job?", text: "I lost my job" },
    { column: "ECONOMIC_IMPACT_EXPECTATION", prompt: "How do you expect AI to impact the economy?", text: "Bad" },
  ]);
  assert.ok(user.includes("PERSONAL_AI_IMPACT"));
  assert.ok(user.includes("I lost my job"));
  assert.ok(user.includes("ECONOMIC_IMPACT_EXPECTATION"));
  assert.ok(user.includes("Bad"));
});

test("validateLabels keeps codes that exist in the codebook and rejects unknown ones", () => {
  const { ok, unknownCodes } = validateLabels(
    { labels: [{ field: "PERSONAL_AI_IMPACT", code: "JOB_LOST" }, { field: "ECONOMIC_IMPACT_EXPECTATION", code: "MADE_UP_CODE" }] },
    FIXTURE_CODEBOOK,
  );
  assert.deepEqual(ok, [{ field: "PERSONAL_AI_IMPACT", code: "JOB_LOST" }]);
  assert.deepEqual(unknownCodes, ["MADE_UP_CODE"]);
});

test("validateLabels accepts an empty labels list", () => {
  const { ok, unknownCodes } = validateLabels({ labels: [] }, FIXTURE_CODEBOOK);
  assert.deepEqual(ok, []);
  assert.deepEqual(unknownCodes, []);
});

test("validateLabels rejects a structurally invalid payload", () => {
  assert.throws(() => validateLabels({ labels: [{ field: "X" }] }, FIXTURE_CODEBOOK));
  assert.throws(() => validateLabels({ notLabels: [] }, FIXTURE_CODEBOOK));
});

test("LABELS_SCHEMA describes the labels array shape", () => {
  assert.equal(LABELS_SCHEMA.type, "object");
  assert.ok("labels" in LABELS_SCHEMA.properties);
});
