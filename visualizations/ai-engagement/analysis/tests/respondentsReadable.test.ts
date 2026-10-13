import { test } from "node:test";
import assert from "node:assert/strict";
import { toReadableRespondents, type RespondentsJson } from "../src/lib/respondentsReadable.ts";

const FIXTURE: RespondentsJson = {
  meta: {
    segments: [
      {
        key: "REGION",
        label: "Region",
        // Display dictionary has folded Sierra Region into "+2 more";
        // rawValues keeps every distinct raw value, unfolded.
        values: ["Bay Area", "+2 more"],
        rawValues: ["Bay Area", "Sierra Region", "Central Coast"],
      },
    ],
    questions: [
      { id: "personal", column: "PERSONAL_AI_IMPACT" },
      { id: "economy", column: "ECONOMIC_IMPACT_EXPECTATION" },
    ],
    statuses: ["substantive", "nonanswer", "refused", "blank", "needs_judgment"],
    themes: [
      { code: "JOB_LOSS", label: "Job losses and displacement", home: "economy" },
      { code: "ADDED_WORKLOAD", label: "More work, same hours", home: "personal" },
    ],
  },
  respondents: [
    {
      id: "r1",
      seg: [1], // folded display bucket
      rawSeg: [1], // true raw value: "Sierra Region"
      status: [0, 3], // personal: substantive, economy: blank
      len: [120, 0],
      themes: [[1], []], // personal: ADDED_WORKLOAD, economy: none
    },
  ],
};

test("decodes a folded segment's display value while keeping the true raw value", () => {
  const [r1] = toReadableRespondents(FIXTURE);
  assert.equal(r1.segments.REGION, "+2 more");
  assert.equal(r1.rawSegments.REGION, "Sierra Region");
});

test("decodes status and length per question, keyed by question id", () => {
  const [r1] = toReadableRespondents(FIXTURE);
  assert.deepEqual(r1.status, { personal: "substantive", economy: "blank" });
  assert.deepEqual(r1.length, { personal: 120, economy: 0 });
});

test("decodes theme indices to theme codes per question, including an empty question", () => {
  const [r1] = toReadableRespondents(FIXTURE);
  assert.deepEqual(r1.themes, { personal: ["ADDED_WORKLOAD"], economy: [] });
});

test("decodes multiple themes on one question in index order", () => {
  const data: RespondentsJson = {
    ...FIXTURE,
    respondents: [{ ...FIXTURE.respondents[0], themes: [[1, 0], []] }],
  };
  const [r1] = toReadableRespondents(data);
  assert.deepEqual(r1.themes.personal, ["ADDED_WORKLOAD", "JOB_LOSS"]);
});

test("preserves the respondent id and produces one output row per input row", () => {
  const data: RespondentsJson = {
    ...FIXTURE,
    respondents: [FIXTURE.respondents[0], { ...FIXTURE.respondents[0], id: "r2" }],
  };
  const rows = toReadableRespondents(data);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ["r1", "r2"]);
});
