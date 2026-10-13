import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSegments,
  foldLongTail,
  encodeRespondents,
  buildThemeIndex,
  REFUSAL_VALUE,
  NOT_STATED_VALUE,
} from "../src/lib/vizdata.ts";
import { PHASE_COLUMN, PHASE_1, PHASE_2 } from "../src/lib/phase.ts";

const CODEBOOK = {
  questions: [
    {
      id: "personal",
      column: "PERSONAL_AI_IMPACT",
      themes: [
        { code: "JOB_LOST", label: "Job lost" },
        { code: "NO_IMPACT", label: "No impact" },
      ],
    },
    {
      id: "economy",
      column: "ECONOMIC_IMPACT_EXPECTATION",
      themes: [{ code: "JOB_LOSS", label: "Job losses and displacement" }],
    },
  ],
};
const QUESTIONS = [
  { id: "personal", column: "PERSONAL_AI_IMPACT" },
  { id: "economy", column: "ECONOMIC_IMPACT_EXPECTATION" },
];

function row(overrides: Record<string, string>): Record<string, string> {
  return { IDEA_ID: "id", AGE: "", FIELD_OF_WORK: "", REGION: "", ...overrides };
}

test("AGE segment keeps declared ordinal order, not count order", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ IDEA_ID: `o${i}`, AGE: "Over 65" })),
    ...Array.from({ length: 3 }, (_, i) => row({ IDEA_ID: `m${i}`, AGE: "25-44" })),
    row({ IDEA_ID: "y0", AGE: "18-24" }),
  ];

  const [age] = buildSegments(rows, ["AGE"]);

  assert.deepEqual(age.values, ["18-24", "25-44", "Over 65"]);
});

test("PHASE segment keeps declared ordinal order (Phase 1, then Phase 2), not count order", () => {
  // Deliberately weighted the opposite way a naive count-sort would land,
  // and fed in reverse order, to prove the order comes from ORDINAL_ORDERS
  // and not from how many rows of each value happen to come first/most.
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ IDEA_ID: `p2-${i}`, [PHASE_COLUMN]: PHASE_2 })),
    row({ IDEA_ID: "p1-0", [PHASE_COLUMN]: PHASE_1 }),
  ];

  const [phase] = buildSegments(rows, [PHASE_COLUMN]);

  assert.deepEqual(phase.values, [PHASE_1, PHASE_2]);
});

test("a refusal category survives long-tail folding and still sorts last", () => {
  // FIELD_OF_WORK now has its own crosswalk-based grouping (see below) —
  // this exercises the generic count-fold path other segments still use,
  // on a neutral fixture key.
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => row({ IDEA_ID: `a${i}`, TEST_SEGMENT: "Field A" })),
    ...Array.from({ length: 15 }, (_, i) => row({ IDEA_ID: `b${i}`, TEST_SEGMENT: "Field B" })),
    ...Array.from({ length: 10 }, (_, i) => row({ IDEA_ID: `c${i}`, TEST_SEGMENT: "Field C" })),
    ...Array.from({ length: 5 }, (_, i) => row({ IDEA_ID: `d${i}`, TEST_SEGMENT: "Field D" })),
    row({ IDEA_ID: "r0", TEST_SEGMENT: REFUSAL_VALUE }),
  ];

  const [field] = buildSegments(rows, ["TEST_SEGMENT"], 3);

  assert.equal(field.values.at(-1), REFUSAL_VALUE);
  assert.ok(!field.values.some((v) => v === REFUSAL_VALUE && v !== field.values.at(-1)));
  assert.ok(field.values.some((v) => v.startsWith("+")));
});

test("a blank demographic cell becomes an explicit (not stated) category, never dropped", () => {
  const rows = [
    row({ IDEA_ID: "a", REGION: "Bay Area" }),
    row({ IDEA_ID: "b", REGION: "" }),
  ];

  const [region] = buildSegments(rows, ["REGION"]);

  assert.ok(region.values.includes(NOT_STATED_VALUE));
});

test("foldLongTail leaves a short list untouched", () => {
  const entries: [string, number][] = [["A", 3], ["B", 2]];
  assert.deepEqual(foldLongTail(entries, 5), entries);
});

test("foldLongTail folds everything past max-1 into an Other bucket", () => {
  const entries: [string, number][] = [["A", 10], ["B", 8], ["C", 5], ["D", 2], ["E", 1]];
  const folded = foldLongTail(entries, 3);
  assert.deepEqual(folded.map(([v]) => v), ["A", "B", "+3 more"]);
  assert.equal(folded.at(-1)?.[1], 8); // 5 + 2 + 1
});

test("encodeRespondents statusCounts sums to the row count for every question", () => {
  const rows = [
    row({ IDEA_ID: "a", REGION: "Bay Area" }),
    row({ IDEA_ID: "b", REGION: "Bay Area" }),
    row({ IDEA_ID: "c", REGION: "LA" }),
  ];
  const segments = buildSegments(rows, ["REGION"]);
  const questions = [{ id: "personal", column: "PERSONAL_AI_IMPACT" }];
  const statuses = {
    a: { personal: "substantive" },
    b: { personal: "blank" },
    c: { personal: "nonanswer" },
  };

  const { meta } = encodeRespondents(rows, segments, questions, statuses, "IDEA_ID");

  const total = meta.statusCounts.personal.reduce((s, c) => s + c, 0);
  assert.equal(total, rows.length);
});

test("encodeRespondents indexes each respondent against the segment and status dictionaries", () => {
  const rows = [row({ IDEA_ID: "a", REGION: "Bay Area" }), row({ IDEA_ID: "b", REGION: "LA" })];
  const segments = buildSegments(rows, ["REGION"]);
  const questions = [{ id: "personal", column: "PERSONAL_AI_IMPACT" }];
  const statuses = { a: { personal: "substantive" }, b: { personal: "blank" } };

  const { respondents } = encodeRespondents(rows, segments, questions, statuses, "IDEA_ID");

  const a = respondents.find((r) => r.id === "a")!;
  const regionIdx = segments[0].values.indexOf("Bay Area");
  assert.equal(a.seg[0], regionIdx);
  assert.equal(a.status[0], 0); // "substantive" is statuses[0]
});

test("rawValues fully enumerates every distinct raw value, even past the fold cap", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row({ IDEA_ID: `x${i}`, TEST_SEGMENT: `Field ${i}` }));

  const [seg] = buildSegments(rows, ["TEST_SEGMENT"], 5);

  assert.equal(seg.rawValues.length, 12);
  assert.ok(seg.values.length < 12);
});

test("FIELD_OF_WORK's crosswalk collapses mapped raw values into a general category, but rawValues keeps them distinct", () => {
  const rows = [
    row({ IDEA_ID: "a", FIELD_OF_WORK: "Government" }),
    row({ IDEA_ID: "b", FIELD_OF_WORK: "Information technology" }),
  ];

  const [field] = buildSegments(rows, ["FIELD_OF_WORK"]);

  assert.ok(field.values.includes("Public sector"));
  assert.ok(!field.values.includes("Government"));
  assert.ok(field.rawValues.includes("Government"));
  assert.ok(field.rawValues.includes("Information technology"));
});

test("an unmapped FIELD_OF_WORK raw value defaults to Other in the display dictionary but keeps its raw identity", () => {
  const rows = [row({ IDEA_ID: "a", FIELD_OF_WORK: "Construction" })];

  const [field] = buildSegments(rows, ["FIELD_OF_WORK"]);

  assert.ok(field.values.includes("Other"));
  assert.ok(field.rawValues.includes("Construction"));
});

test("FIELD_OF_WORK's 'I don't currently work' passes through the crosswalk unchanged, not folded into Other", () => {
  const rows = [row({ IDEA_ID: "a", FIELD_OF_WORK: "I don't currently work" })];

  const [field] = buildSegments(rows, ["FIELD_OF_WORK"]);

  assert.ok(field.values.includes("I don't currently work"));
  assert.ok(!field.values.includes("Other"));
});

test("encodeRespondents' rawSeg resolves to the true raw category even when seg resolves to a crosswalked bucket", () => {
  const rows = [row({ IDEA_ID: "a", FIELD_OF_WORK: "Government" })];
  const segments = buildSegments(rows, ["FIELD_OF_WORK"]);
  const questions = [{ id: "personal", column: "PERSONAL_AI_IMPACT" }];

  const { respondents } = encodeRespondents(rows, segments, questions, { a: { personal: "substantive" } }, "IDEA_ID");

  const a = respondents[0];
  const field = segments[0];
  assert.equal(field.values[a.seg[0]], "Public sector");
  assert.equal(field.rawValues[a.rawSeg[0]], "Government");
});

test("AI_RESPONSE_LABEL renames raw codes to display labels, sorted by count, with rawValues kept literal", () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => row({ IDEA_ID: `n${i}`, AI_RESPONSE_LABEL: "neg" })),
    ...Array.from({ length: 2 }, (_, i) => row({ IDEA_ID: `m${i}`, AI_RESPONSE_LABEL: "mix" })),
    row({ IDEA_ID: "p0", AI_RESPONSE_LABEL: "pos" }),
    row({ IDEA_ID: "u0", AI_RESPONSE_LABEL: "neutral" }),
    row({ IDEA_ID: "b0", AI_RESPONSE_LABEL: "" }),
  ];

  const [stance] = buildSegments(rows, ["AI_RESPONSE_LABEL"]);

  assert.deepEqual(stance.values, ["Negative", "Mixed", "Positive", "Neutral", NOT_STATED_VALUE]);
  assert.deepEqual(stance.rawValues, ["neg", "mix", "pos", "neutral", NOT_STATED_VALUE]);
  assert.equal(stance.label, "Stance");
});

test("encodeRespondents resolves a raw stance code to its display label's index", () => {
  const rows = [row({ IDEA_ID: "a", AI_RESPONSE_LABEL: "neg" }), row({ IDEA_ID: "b", AI_RESPONSE_LABEL: "" })];
  const segments = buildSegments(rows, ["AI_RESPONSE_LABEL"]);
  const questions = [{ id: "personal", column: "PERSONAL_AI_IMPACT" }];

  const { respondents } = encodeRespondents(rows, segments, questions, {}, "IDEA_ID");

  const stance = segments[0];
  const a = respondents.find((r) => r.id === "a")!;
  const b = respondents.find((r) => r.id === "b")!;
  assert.equal(stance.values[a.seg[0]], "Negative");
  assert.equal(stance.rawValues[a.rawSeg[0]], "neg");
  assert.equal(stance.values[b.seg[0]], NOT_STATED_VALUE);
});

test("buildThemeIndex builds one flat, globally-indexed theme dictionary in codebook order", () => {
  const { themes } = buildThemeIndex(CODEBOOK, [], QUESTIONS, ["a"], {});

  assert.deepEqual(themes, [
    { code: "JOB_LOST", label: "Job lost", home: "personal" },
    { code: "NO_IMPACT", label: "No impact", home: "personal" },
    { code: "JOB_LOSS", label: "Job losses and displacement", home: "economy" },
  ]);
});

test("buildThemeIndex buckets a label into the question it was actually answered under, not its home question", () => {
  // JOB_LOSS's home is "economy", but this label was assigned against the
  // "personal" question — cross-field bleed must survive the export.
  const labels = [{ id: "a", field: "personal", code: "JOB_LOSS" }];

  const { themes, themesByRespondent } = buildThemeIndex(CODEBOOK, labels, QUESTIONS, ["a"], {});

  const jobLossIdx = themes.findIndex((t) => t.code === "JOB_LOSS");
  const perQuestion = themesByRespondent.get("a")!;
  assert.deepEqual(perQuestion[0], [jobLossIdx]); // personal
  assert.deepEqual(perQuestion[1], []); // economy
});

test("buildThemeIndex's themeCounts tally distinct respondents per theme, per the question array they landed in", () => {
  const labels = [
    { id: "a", field: "personal", code: "JOB_LOST" },
    { id: "b", field: "personal", code: "JOB_LOST" },
    { id: "c", field: "personal", code: "NO_IMPACT" },
  ];

  const { themes, themeCounts } = buildThemeIndex(CODEBOOK, labels, QUESTIONS, ["a", "b", "c"], {});

  const jobLostIdx = themes.findIndex((t) => t.code === "JOB_LOST");
  const noImpactIdx = themes.findIndex((t) => t.code === "NO_IMPACT");
  assert.equal(themeCounts.personal[jobLostIdx], 2);
  assert.equal(themeCounts.personal[noImpactIdx], 1);
});

test("buildThemeIndex's themeDenominators count substantive respondents for each question, independent of labels", () => {
  const statusById = {
    a: { personal: "substantive", economy: "blank" },
    b: { personal: "nonanswer", economy: "substantive" },
    c: { personal: "substantive", economy: "substantive" },
  };

  const { themeDenominators } = buildThemeIndex(CODEBOOK, [], QUESTIONS, ["a", "b", "c"], statusById);

  assert.equal(themeDenominators.personal, 2);
  assert.equal(themeDenominators.economy, 2);
});

test("encodeRespondents carries each respondent's per-question theme indices through to the export", () => {
  const rows = [row({ IDEA_ID: "a" })];
  const segments = buildSegments(rows, ["REGION"]);
  const labels = [{ id: "a", field: "personal", code: "JOB_LOST" }];
  const themeIndex = buildThemeIndex(CODEBOOK, labels, QUESTIONS, ["a"], { a: { personal: "substantive" } });

  const { respondents, meta } = encodeRespondents(
    rows,
    segments,
    QUESTIONS,
    { a: { personal: "substantive" } },
    "IDEA_ID",
    themeIndex,
  );

  const jobLostIdx = meta.themes.findIndex((t) => t.code === "JOB_LOST");
  assert.deepEqual(respondents[0].themes[0], [jobLostIdx]);
  assert.deepEqual(respondents[0].themes[1], []);
  assert.deepEqual(meta.themes, themeIndex.themes);
  assert.deepEqual(meta.themeCounts, themeIndex.themeCounts);
  assert.deepEqual(meta.themeDenominators, themeIndex.themeDenominators);
});

test("encodeRespondents defaults to empty theme data when no theme index is given (pre-classification export)", () => {
  const rows = [row({ IDEA_ID: "a" })];
  const segments = buildSegments(rows, ["REGION"]);

  const { respondents, meta } = encodeRespondents(rows, segments, QUESTIONS, { a: { personal: "substantive" } }, "IDEA_ID");

  assert.deepEqual(meta.themes, []);
  assert.deepEqual(respondents[0].themes, [[], []]);
});
