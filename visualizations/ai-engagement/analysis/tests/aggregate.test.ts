import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/lib/aggregate.ts";
import type { Codebook } from "../src/lib/codebook.ts";

const FIXTURE_CODEBOOK: Codebook = {
  version: "test",
  questions: [
    {
      id: "personal",
      column: "PERSONAL_AI_IMPACT",
      prompt: "How has AI impacted your job and workplace, if at all?",
      themes: [
        { code: "THEME_A", label: "Theme A", definition: "d", includes: [], excludes: [], examples: [] },
        { code: "THEME_B", label: "Theme B", definition: "d", includes: [], excludes: [], examples: [] },
      ],
    },
    {
      id: "economy",
      column: "ECONOMIC_IMPACT_EXPECTATION",
      prompt: "How do you expect AI to impact the economy?",
      themes: [{ code: "THEME_C", label: "Theme C", definition: "d", includes: [], excludes: [], examples: [] }],
    },
  ],
};

const BASE_OPTS = {
  demoColumns: ["REGION"],
  segmentLabels: { REGION: "Region" },
  model: "test-model",
  sampleCaveat: "caveat text",
  multiLabelNote: "multi-label note",
  suppressBelow: 10,
  flagBelow: 30,
};

function statusRows(ids: string[], question: string, status: string) {
  return ids.map((id) => ({ id, question, status }));
}

test("a theme's share uses the substantive denominator for its home question, not the total row count", () => {
  // 8 respondents total; only 4 are substantive on "personal". THEME_A is
  // raised by 2 of those 4 substantive respondents.
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
  const statuses = [
    ...statusRows(["r1", "r2", "r3", "r4"], "personal", "substantive"),
    ...statusRows(["r5", "r6", "r7", "r8"], "personal", "blank"),
    ...statusRows(ids, "economy", "blank"),
  ];
  const labels = [
    { id: "r1", field: "personal", code: "THEME_A" },
    { id: "r2", field: "personal", code: "THEME_A" },
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  assert.equal(personal.counts.substantive, 4);
  const themeA = personal.themes.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.count, 2);
  assert.equal(themeA.share, 0.5); // 2 / 4, not 2 / 8
});

test("a respondent whose only label for a theme's code came from a different field is excluded from that theme's per-question count, but still counted in personLevel", () => {
  const ids = ["r1", "r2"];
  const statuses = [
    ...statusRows(ids, "personal", "substantive"),
    ...statusRows(ids, "economy", "substantive"),
  ];
  // r1 raised THEME_A (home: personal) while actually answering "personal".
  // r2 raised the same code only while answering "economy" — cross-field
  // bleed, with no personal-field label of their own.
  const labels = [
    { id: "r1", field: "personal", code: "THEME_A" },
    { id: "r2", field: "economy", code: "THEME_A" },
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const themeA = personal.themes.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.count, 1);
  assert.deepEqual(themeA.respondentIds, ["r1"]);

  const personLevelThemeA = result.personLevel.find((t) => t.code === "THEME_A")!;
  assert.equal(personLevelThemeA.respondentCount, 2); // bleed still visible here — no per-question denominator to protect
});

test("a respondent labeled with the same code twice via the same field counts once", () => {
  const ids = ["r1", "r2"];
  const statuses = statusRows(ids, "personal", "substantive");
  const labels = [
    { id: "r1", field: "personal", code: "THEME_A" },
    { id: "r1", field: "personal", code: "THEME_A" },
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const themeA = personal.themes.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.count, 1);
  assert.deepEqual(themeA.respondentIds, ["r1"]);
});

test("segment cell theme counts exclude cross-field bleed too, matching the per-question rule", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
  const statuses = statusRows(ids, "personal", "substantive");
  // r0 raised THEME_A on the personal field itself — counts.
  // r1 raised the same code only via economy — bleed, excluded.
  const labels = [
    { id: "r0", field: "personal", code: "THEME_A" },
    { id: "r1", field: "economy", code: "THEME_A" },
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Central Coast" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const region = personal.segments.find((s) => s.key === "REGION")!;
  const cell = region.values["Central Coast"];
  const themeA = cell.themes!.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.count, 1);
});

test("a segment cell under suppressBelow publishes n only, no theme breakdown", () => {
  const ids = Array.from({ length: 3 }, (_, i) => `r${i}`);
  const statuses = statusRows(ids, "personal", "substantive");
  const labels = [{ id: "r0", field: "personal", code: "THEME_A" }];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Sierra Region" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const region = personal.segments.find((s) => s.key === "REGION")!;
  const cell = region.values["Sierra Region"];
  assert.equal(cell.n, 3);
  assert.equal(cell.suppressed, true);
  assert.equal(cell.themes, undefined);
});

test("a segment cell between suppressBelow and flagBelow publishes everything but flags wide uncertainty", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
  const statuses = statusRows(ids, "personal", "substantive");
  const labels = [{ id: "r0", field: "personal", code: "THEME_A" }];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Central Coast" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const region = personal.segments.find((s) => s.key === "REGION")!;
  const cell = region.values["Central Coast"];
  assert.equal(cell.n, 12);
  assert.equal(cell.suppressed, false);
  assert.equal(cell.wideUncertainty, true);
  assert.ok(cell.themes && cell.themes.length > 0);
});

test("a refusal demographic value is its own segment category, never dropped", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `r${i}`);
  const statuses = statusRows(ids, "personal", "substantive");
  const demographicRows = ids.map((id, i) => ({ IDEA_ID: id, REGION: i === 0 ? "I don't want to say" : "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels: [],
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const region = personal.segments.find((s) => s.key === "REGION")!;
  assert.ok("I don't want to say" in region.values);
  assert.equal(region.values["I don't want to say"].n, 1);
});

test("a blank demographic cell becomes an explicit (not stated) category, never dropped", () => {
  const ids = ["r0", "r1"];
  const statuses = statusRows(ids, "personal", "substantive");
  const demographicRows = [
    { IDEA_ID: "r0", REGION: "" },
    { IDEA_ID: "r1", REGION: "Bay Area" },
  ];

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels: [],
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const region = personal.segments.find((s) => s.key === "REGION")!;
  assert.ok("(not stated)" in region.values);
});

test("near-dup clusters collapse to one representative in countExclDups, without changing the raw count", () => {
  const ids = ["r1", "r2", "r3"];
  const statuses = statusRows(ids, "personal", "substantive");
  const labels = [
    { id: "r1", field: "personal", code: "THEME_A" },
    { id: "r2", field: "personal", code: "THEME_A" },
    { id: "r3", field: "personal", code: "THEME_A" },
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    // r1 and r2 are a templated near-dup pair on the personal question; r3 is independent.
    dupClusters: { personal: [{ clusterId: 0, ids: ["r1", "r2"] }] },
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const personal = result.questions.find((q) => q.id === "personal")!;
  const themeA = personal.themes.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.count, 3); // raw count unaffected
  assert.equal(themeA.countExclDups, 2); // r1+r2 collapse to one voice, plus r3
});

test("person-level counts are distinct across all fields, independent of any one question's denominator", () => {
  const ids = ["r1", "r2"];
  const statuses = [...statusRows(ids, "personal", "substantive"), ...statusRows(ids, "economy", "substantive")];
  const labels = [
    { id: "r1", field: "personal", code: "THEME_A" },
    { id: "r2", field: "economy", code: "THEME_A" }, // bled from personal's theme
  ];
  const demographicRows = ids.map((id) => ({ IDEA_ID: id, REGION: "Bay Area" }));

  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels,
    statuses,
    dupClusters: {},
    demographicRows,
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  const themeA = result.personLevel.find((t) => t.code === "THEME_A")!;
  assert.equal(themeA.respondentCount, 2);
});

test("report metadata carries the codebook version, model, sample caveat, and multi-label note", () => {
  const result = aggregate({
    codebook: FIXTURE_CODEBOOK,
    labels: [],
    statuses: [],
    dupClusters: {},
    demographicRows: [],
    idColumn: "IDEA_ID",
    ...BASE_OPTS,
  });

  assert.equal(result.meta.codebookVersion, "test");
  assert.equal(result.meta.model, "test-model");
  assert.equal(result.meta.sampleCaveat, "caveat text");
  assert.equal(result.meta.multiLabelNote, "multi-label note");
});
