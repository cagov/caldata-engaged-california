import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThemeOptions, computeHighlight } from "../src/lib/themes.ts";
import type { ThemeMeta } from "../src/lib/data.ts";

const THEMES: ThemeMeta[] = [
  { code: "JOB_LOST", label: "Job lost", home: "personal" },
  { code: "NO_IMPACT", label: "No impact", home: "personal" },
  { code: "JOB_LOSS", label: "Job losses and displacement", home: "economy" },
];

test("buildThemeOptions scopes to the given question's home themes only", () => {
  const counts = [10, 5, 999]; // JOB_LOSS's huge count must not leak into "personal"
  const options = buildThemeOptions(THEMES, counts, 100, "personal");

  assert.deepEqual(options.map((o) => o.code), ["JOB_LOST", "NO_IMPACT"]);
});

test("buildThemeOptions sorts by count descending", () => {
  const counts = [5, 10, 0];
  const options = buildThemeOptions(THEMES, counts, 100, "personal");

  assert.deepEqual(options.map((o) => o.code), ["NO_IMPACT", "JOB_LOST"]);
});

test("buildThemeOptions computes pct against the given denominator, rounded", () => {
  const counts = [33, 0, 0];
  const options = buildThemeOptions(THEMES, counts, 100, "personal");

  const jobLost = options.find((o) => o.code === "JOB_LOST")!;
  assert.equal(jobLost.count, 33);
  assert.equal(jobLost.pct, 33);
});

test("buildThemeOptions returns pct 0 for a zero denominator instead of dividing by zero", () => {
  const options = buildThemeOptions(THEMES, [5, 0, 0], 0, "personal");

  assert.equal(options[0].pct, 0);
});

test("computeHighlight returns null when no theme is selected", () => {
  const respondents = [{ themes: [[0], []] }];
  assert.equal(computeHighlight(respondents, 0, null), null);
});

test("computeHighlight matches respondents who raised the theme on the given question", () => {
  const respondents = [
    { themes: [[0, 1], []] }, // has theme 0 on question 0
    { themes: [[1], []] }, // does not have theme 0 on question 0
  ];

  assert.deepEqual(computeHighlight(respondents, 0, 0), [true, false]);
});

test("computeHighlight only looks at the given question's array, not any other question's", () => {
  // Theme 0 was raised on question 1, not question 0 — must not match there.
  const respondents = [{ themes: [[], [0]] }];

  assert.deepEqual(computeHighlight(respondents, 0, 0), [false]);
  assert.deepEqual(computeHighlight(respondents, 1, 0), [true]);
});
