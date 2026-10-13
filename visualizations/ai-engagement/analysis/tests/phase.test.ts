import { test } from "node:test";
import assert from "node:assert/strict";
import { attendeeIds, withPhaseColumn, unmatchedAttendees, PHASE_COLUMN, PHASE_1, PHASE_2 } from "../src/lib/phase.ts";

test("attendeeIds collects every SURVEY_RESPONDENT_ID from the attendee rows", () => {
  const rows = [
    { SURVEY_RESPONDENT_ID: "a", ATTENDEE_STATUS: "attended" },
    { SURVEY_RESPONDENT_ID: "b", ATTENDEE_STATUS: "" },
  ];
  const ids = attendeeIds(rows, "SURVEY_RESPONDENT_ID");
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("attendeeIds drops blank ids rather than treating them as a real id", () => {
  const rows = [{ SURVEY_RESPONDENT_ID: "", ATTENDEE_STATUS: "attended" }];
  const ids = attendeeIds(rows, "SURVEY_RESPONDENT_ID");
  assert.equal(ids.size, 0);
});

test("withPhaseColumn tags matched ids Phase 2 and everyone else Phase 1", () => {
  const rows = [
    { SURVEY_RESPONDENT_ID: "a" },
    { SURVEY_RESPONDENT_ID: "b" },
    { SURVEY_RESPONDENT_ID: "c" },
  ];
  const ids = new Set(["b"]);

  const phased = withPhaseColumn(rows, ids, "SURVEY_RESPONDENT_ID");

  assert.deepEqual(phased.map((r) => r[PHASE_COLUMN]), [PHASE_1, PHASE_2, PHASE_1]);
});

test("withPhaseColumn never mutates its input rows", () => {
  const rows = [{ SURVEY_RESPONDENT_ID: "a" }];
  const original = { ...rows[0] };

  withPhaseColumn(rows, new Set(["a"]), "SURVEY_RESPONDENT_ID");

  assert.deepEqual(rows[0], original);
});

test("withPhaseColumn on an empty attendee set marks every row Phase 1", () => {
  const rows = [{ SURVEY_RESPONDENT_ID: "a" }, { SURVEY_RESPONDENT_ID: "b" }];

  const phased = withPhaseColumn(rows, new Set(), "SURVEY_RESPONDENT_ID");

  assert.ok(phased.every((r) => r[PHASE_COLUMN] === PHASE_1));
});

test("unmatchedAttendees returns attendee ids with no matching respondent row", () => {
  const rows = [{ SURVEY_RESPONDENT_ID: "a" }, { SURVEY_RESPONDENT_ID: "b" }];
  const ids = new Set(["a", "b", "orphan"]);

  const unmatched = unmatchedAttendees(rows, ids, "SURVEY_RESPONDENT_ID");

  assert.deepEqual(unmatched, ["orphan"]);
});

test("unmatchedAttendees returns nothing when every attendee id is present", () => {
  const rows = [{ SURVEY_RESPONDENT_ID: "a" }];
  const ids = new Set(["a"]);

  assert.deepEqual(unmatchedAttendees(rows, ids, "SURVEY_RESPONDENT_ID"), []);
});
