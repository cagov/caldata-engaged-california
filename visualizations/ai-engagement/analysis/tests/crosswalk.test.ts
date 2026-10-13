import { test } from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import {
  validateCrosswalk,
  computeUnclaimed,
  computeConceptMetrics,
  STRENGTH_WEIGHT,
  type PhaseCrosswalkFile,
} from "../src/lib/crosswalk.ts";
import { loadCsv } from "../src/lib/load.ts";
import { POLICY_CONCEPTS_V2_CSV } from "../src/config.ts";

function baseCrosswalk(): PhaseCrosswalkFile {
  return {
    version: "test",
    codebookVersion: "cb-1",
    roomsSourceHash: "hash-1",
    status: "proposed",
    approvedBy: null,
    method: "test fixture",
    concepts: [
      { conceptId: "C-01", sources: [{ code: "REGULATE", field: "government", strength: "primary", rationale: "matches" }] },
      { conceptId: "C-02", sources: [{ code: "JOB_LOSS", field: "economy", strength: "secondary", rationale: "matches" }] },
    ],
  };
}

const VALID_OPTS = {
  conceptIds: ["C-01", "C-02"],
  codebookVersion: "cb-1",
  roomsSourceHash: "hash-1",
  themeCodes: ["REGULATE", "JOB_LOSS"],
  themeCountsByField: { government: { REGULATE: 100 }, economy: { JOB_LOSS: 50 } },
};

test("validateCrosswalk accepts a well-formed crosswalk", () => {
  assert.deepEqual(validateCrosswalk(baseCrosswalk(), VALID_OPTS), []);
});

test("validateCrosswalk rejects a conceptId that doesn't exist in rooms.json", () => {
  const cw = baseCrosswalk();
  cw.concepts[0].conceptId = "C-99";
  const errors = validateCrosswalk(cw, VALID_OPTS);
  assert.ok(errors.some((e) => e.includes("C-99")));
});

test("validateCrosswalk rejects missing concept coverage", () => {
  const cw = baseCrosswalk();
  cw.concepts.pop();
  const errors = validateCrosswalk(cw, VALID_OPTS);
  assert.ok(errors.some((e) => e.includes("C-02") && e.includes("missing")));
});

test("validateCrosswalk rejects a stale codebookVersion", () => {
  const errors = validateCrosswalk(baseCrosswalk(), { ...VALID_OPTS, codebookVersion: "cb-2" });
  assert.ok(errors.some((e) => e.includes("codebookVersion")));
});

test("validateCrosswalk rejects a stale roomsSourceHash", () => {
  const errors = validateCrosswalk(baseCrosswalk(), { ...VALID_OPTS, roomsSourceHash: "hash-2" });
  assert.ok(errors.some((e) => e.includes("roomsSourceHash")));
});

test("validateCrosswalk rejects a theme code not in the codebook", () => {
  const cw = baseCrosswalk();
  cw.concepts[0].sources[0].code = "NOT_A_REAL_CODE";
  const errors = validateCrosswalk(cw, VALID_OPTS);
  assert.ok(errors.some((e) => e.includes("NOT_A_REAL_CODE")));
});

test("validateCrosswalk rejects an empty rationale", () => {
  const cw = baseCrosswalk();
  cw.concepts[0].sources[0].rationale = "  ";
  const errors = validateCrosswalk(cw, VALID_OPTS);
  assert.ok(errors.some((e) => e.includes("rationale")));
});

test("validateCrosswalk rejects a duplicate theme code within one concept", () => {
  const cw = baseCrosswalk();
  cw.concepts[0].sources.push({ code: "REGULATE", field: "government", strength: "secondary", rationale: "dup" });
  const errors = validateCrosswalk(cw, VALID_OPTS);
  assert.ok(errors.some((e) => e.includes("twice")));
});

test("validateCrosswalk rejects an edge whose field has zero respondents for that theme", () => {
  const cw = baseCrosswalk();
  const opts = { ...VALID_OPTS, themeCountsByField: { government: { REGULATE: 0 }, economy: { JOB_LOSS: 50 } } };
  const errors = validateCrosswalk(cw, opts);
  assert.ok(errors.some((e) => e.includes("zero respondents")));
});

test("computeUnclaimed returns exactly the themes cited by no concept", () => {
  const themes = [
    { code: "REGULATE", home: "government" },
    { code: "JOB_LOSS", home: "economy" },
    { code: "NO_IMPACT", home: "personal" },
  ];
  assert.deepEqual(computeUnclaimed(baseCrosswalk(), themes), [{ code: "NO_IMPACT", home: "personal" }]);
});

test("STRENGTH_WEIGHT ranks primary > secondary > tangential", () => {
  assert.ok(STRENGTH_WEIGHT.primary > STRENGTH_WEIGHT.secondary);
  assert.ok(STRENGTH_WEIGHT.secondary > STRENGTH_WEIGHT.tangential);
});

test("computeConceptMetrics reproduces the v2 CSV's own ranking columns", { skip: !existsSync(POLICY_CONCEPTS_V2_CSV) && "policy-concepts v2 CSV not present" }, async () => {
  const rows = (await loadCsv(POLICY_CONCEPTS_V2_CSV)).filter((r) => r["Policy concept"] && r["Theme"]);
  // The workbook only writes "Vote to idea ratio" on the FIRST data row of
  // each subtheme group (a merged-cell export artifact) — every other row
  // in the group has a blank cell there even though the value applies
  // equally to all of them (per computeConceptMetrics' own doc comment).
  // Both rows below are the first row of their subtheme group, so their
  // cell is populated and directly comparable.
  const determineFields = rows.find((r) => r["Policy concept"].trim() === "Determine fields/areas where AI can be used safely")!;
  const metrics1 = computeConceptMetrics(
    { sessions: Number(determineFields["Sessions"]), ideas: Number(determineFields["Ideas"]), topIdeas: Number(determineFields["Top"]) },
    { votes: 112, ideas: 33 },
    14,
  );
  assert.equal(metrics1.sessionsPct, Number(determineFields["Sessions %"].replace("%", "")));
  assert.equal(metrics1.topPct, Number(determineFields["Top %"].replace("%", "")));
  assert.ok(Math.abs(metrics1.voteToIdeaRatio - Number(determineFields["Vote to idea ratio"])) < 1e-6);
  assert.equal(metrics1.compositePctSum, Number(determineFields["Composite metric (sessions % + top %)"].replace("%", "")));
  assert.equal(metrics1.compositeCountSum, Number(determineFields["Composite metric (sessions + top)"]));

  const holdAccountable = rows.find((r) => r["Policy concept"].trim() === "Hold AI companies accountable for protecting consumers")!;
  const metrics2 = computeConceptMetrics(
    { sessions: Number(holdAccountable["Sessions"]), ideas: Number(holdAccountable["Ideas"]), topIdeas: Number(holdAccountable["Top"]) },
    { votes: 72, ideas: 19 },
    14,
  );
  assert.equal(metrics2.sessionsPct, Number(holdAccountable["Sessions %"].replace("%", "")));
  assert.equal(metrics2.topPct, Number(holdAccountable["Top %"].replace("%", "")));
  assert.ok(Math.abs(metrics2.voteToIdeaRatio - Number(holdAccountable["Vote to idea ratio"])) < 1e-6);

  // "Empowering people to protect their data" is the one subtheme where the
  // workbook's stated header total (82 votes / 24 ideas) disagrees with
  // rooms.json's reconciled total (94 votes / 26 ideas) — computeConceptMetrics
  // uses the reconciled total, so this asserts against 94/26 directly rather
  // than the CSV's own (stale, stated-based) "Vote to idea ratio" cell for
  // rows under this subtheme.
  const ensureProperUse = rows.find((r) => r["Policy concept"].trim() === "Ensure companies use data properly and transparently")!;
  const metrics3 = computeConceptMetrics(
    { sessions: Number(ensureProperUse["Sessions"]), ideas: Number(ensureProperUse["Ideas"]), topIdeas: Number(ensureProperUse["Top"]) },
    { votes: 94, ideas: 26 },
    14,
  );
  assert.equal(metrics3.sessionsPct, Number(ensureProperUse["Sessions %"].replace("%", "")));
  assert.equal(metrics3.topPct, Number(ensureProperUse["Top %"].replace("%", "")));
  assert.ok(Math.abs(metrics3.voteToIdeaRatio - 94 / 26) < 1e-6);
});
