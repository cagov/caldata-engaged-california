import { test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "csv-stringify/sync";
import { buildThemeRows, COLUMN_DICTIONARY, CSV_COLUMNS } from "../src/lib/themesCsv.ts";
import type { Codebook } from "../src/lib/codebook.ts";
import type { PrevalenceData } from "../src/lib/aggregate.ts";

const FIXTURE_CODEBOOK: Codebook = {
  version: "test",
  questions: [
    {
      id: "economy",
      column: "ECONOMIC_IMPACT_EXPECTATION",
      prompt: "How do you expect AI to impact the economy?",
      themes: [
        {
          code: "JOB_LOSS",
          label: "Job losses and displacement",
          definition: "Respondent expects AI to eliminate jobs.",
          includes: [],
          excludes: [],
          examples: [],
          verification: "supported",
        },
        {
          code: "PRODUCTIVITY",
          label: "Higher productivity",
          definition: "Respondent expects AI to raise output, efficiency.",
          includes: [],
          excludes: [],
          examples: [],
          verification: "supported",
        },
        {
          code: "NOT_IN_PREVALENCE",
          label: "Never classified",
          definition: "A theme present in the codebook but absent from labels.jsonl.",
          includes: [],
          excludes: [],
          examples: [],
          verification: "needs_verification",
        },
      ],
    },
  ],
};

function fixturePrevalence(): PrevalenceData {
  return {
    meta: {
      codebookVersion: "test",
      model: "test-model",
      generated: "2026-01-01T00:00:00.000Z",
      sampleCaveat: "caveat",
      multiLabelNote: "note",
    },
    questions: [
      {
        id: "economy",
        prompt: "How do you expect AI to impact the economy?",
        counts: { total: 200, substantive: 100, blank: 80, refused: 0, nonanswer: 20 },
        themes: [
          // Deliberately out of the order buildThemeRows should produce, and
          // missing NOT_IN_PREVALENCE entirely.
          {
            code: "PRODUCTIVITY",
            label: "Higher productivity",
            count: 10,
            share: 0.1,
            ciLow: 0.05,
            ciHigh: 0.17,
            countExclDups: 10,
            respondentIds: ["r1"],
            verification: "supported",
          },
          {
            code: "JOB_LOSS",
            label: "Job losses and displacement",
            count: 64,
            share: 0.64,
            ciLow: 0.54,
            ciHigh: 0.73,
            countExclDups: 64,
            respondentIds: ["r2"],
            verification: "supported",
          },
        ],
        segments: [],
      },
    ],
    personLevel: [],
  };
}

test("one row per codebook theme, including a theme absent from prevalence.json", () => {
  const rows = buildThemeRows(FIXTURE_CODEBOOK, fixturePrevalence());
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.theme_code),
    ["JOB_LOSS", "PRODUCTIVITY", "NOT_IN_PREVALENCE"],
  );
});

test("a codebook theme missing from prevalence.json gets zero counts, not dropped", () => {
  const rows = buildThemeRows(FIXTURE_CODEBOOK, fixturePrevalence());
  const missing = rows.find((r) => r.theme_code === "NOT_IN_PREVALENCE")!;
  assert.equal(missing.respondents, 0);
  assert.equal(missing.pct_of_answered, 0);
  assert.equal(missing.pct_of_all, 0);
  assert.equal(missing.denominator_answered, 100);
  assert.equal(missing.denominator_all, 200);
});

test("percentages are computed against both denominators and rounded to one decimal", () => {
  const rows = buildThemeRows(FIXTURE_CODEBOOK, fixturePrevalence());
  const jobLoss = rows.find((r) => r.theme_code === "JOB_LOSS")!;
  assert.equal(jobLoss.respondents, 64);
  assert.equal(jobLoss.denominator_answered, 100);
  assert.equal(jobLoss.pct_of_answered, 64); // 64/100
  assert.equal(jobLoss.denominator_all, 200);
  assert.equal(jobLoss.pct_of_all, 32); // 64/200

  const productivity = rows.find((r) => r.theme_code === "PRODUCTIVITY")!;
  assert.equal(productivity.pct_of_answered, 10); // 10/100
  assert.equal(productivity.pct_of_all, 5); // 10/200
});

test("rows within a question are sorted by pct_of_answered descending", () => {
  const rows = buildThemeRows(FIXTURE_CODEBOOK, fixturePrevalence());
  const codes = rows.map((r) => r.theme_code);
  assert.deepEqual(codes, ["JOB_LOSS", "PRODUCTIVITY", "NOT_IN_PREVALENCE"]);
});

test("each row carries the theme's label, description, verification flag, and home question prompt", () => {
  const rows = buildThemeRows(FIXTURE_CODEBOOK, fixturePrevalence());
  const jobLoss = rows.find((r) => r.theme_code === "JOB_LOSS")!;
  assert.equal(jobLoss.theme_label, "Job losses and displacement");
  assert.equal(jobLoss.theme_description, "Respondent expects AI to eliminate jobs.");
  assert.equal(jobLoss.verification, "supported");
  assert.equal(jobLoss.survey_question, "How do you expect AI to impact the economy?");

  const flagged = rows.find((r) => r.theme_code === "NOT_IN_PREVALENCE")!;
  assert.equal(flagged.verification, "needs_verification");
});

test("a definition containing a comma survives a CSV round-trip in one cell", () => {
  const codebook: Codebook = {
    version: "test",
    questions: [
      {
        id: "personal",
        column: "PERSONAL_AI_IMPACT",
        prompt: "prompt",
        themes: [
          {
            code: "COMMA_THEME",
            label: "Has, a comma",
            definition: "Includes commas, and more commas, for good measure.",
            includes: [],
            excludes: [],
            examples: [],
            verification: "supported",
          },
        ],
      },
    ],
  };
  const prevalence: PrevalenceData = {
    meta: { codebookVersion: "test", model: "test-model", generated: "now", sampleCaveat: "c", multiLabelNote: "n" },
    questions: [
      {
        id: "personal",
        prompt: "prompt",
        counts: { total: 10, substantive: 5, blank: 3, refused: 0, nonanswer: 2 },
        themes: [
          {
            code: "COMMA_THEME",
            label: "Has, a comma",
            count: 1,
            share: 0.2,
            ciLow: 0,
            ciHigh: 1,
            countExclDups: 1,
            respondentIds: ["r1"],
            verification: "supported",
          },
        ],
        segments: [],
      },
    ],
    personLevel: [],
  };

  const rows = buildThemeRows(codebook, prevalence);
  const csv = stringify(rows, { header: true, columns: CSV_COLUMNS, quoted: true });
  assert.match(csv, /"Includes commas, and more commas, for good measure\."/);
  // Round-trip: exactly one row's worth of content, not split across lines by the comma.
  const dataLines = csv.trim().split("\n").slice(1);
  assert.equal(dataLines.length, 1);
});

test("every CSV column has a non-empty data dictionary entry, and no extras", () => {
  assert.deepEqual(Object.keys(COLUMN_DICTIONARY).sort(), [...CSV_COLUMNS].sort());
  for (const col of CSV_COLUMNS) {
    assert.ok(COLUMN_DICTIONARY[col].length > 0, `missing description for ${col}`);
  }
});

test("the emitted CSV never contains a respondent UUID", () => {
  const prevalence = fixturePrevalence();
  prevalence.questions[0].themes[0].respondentIds = ["11111111-2222-3333-4444-555555555555"];
  const rows = buildThemeRows(FIXTURE_CODEBOOK, prevalence);
  const csv = stringify(rows, { header: true, columns: CSV_COLUMNS, quoted: true });
  assert.doesNotMatch(csv, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
