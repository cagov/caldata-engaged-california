import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRegion,
  normalizePhase1FieldOfWork,
  normalizePhase2FieldOfWork,
  buildFunnelCategories,
  buildFunnelSessions,
  buildFunnelData,
  parseSortitionInvited,
} from "../src/lib/funnel.ts";

test("normalizeRegion maps blank to (not stated)", () => {
  assert.equal(normalizeRegion(""), "(not stated)");
  assert.equal(normalizeRegion("  "), "(not stated)");
  assert.equal(normalizeRegion("Bay Area"), "Bay Area");
});

test("normalizePhase1FieldOfWork merges the Good(s) producing and harvesting typo", () => {
  assert.equal(normalizePhase1FieldOfWork("Good producing and harvesting"), "Goods producing and harvesting");
  assert.equal(normalizePhase1FieldOfWork("Goods producing and harvesting"), "Goods producing and harvesting");
});

test("normalizePhase1FieldOfWork passes refusal, not-currently-working, and blank through untouched", () => {
  assert.equal(normalizePhase1FieldOfWork("I don't want to say"), "I don't want to say");
  assert.equal(normalizePhase1FieldOfWork("I don't currently work"), "I don't currently work");
  assert.equal(normalizePhase1FieldOfWork(""), "(not stated)");
});

test("normalizePhase2FieldOfWork renames sortition-grouping labels onto the phase 1 rollup taxonomy", () => {
  assert.equal(normalizePhase2FieldOfWork("Arts, entertainment, or media"), "Creative");
  assert.equal(normalizePhase2FieldOfWork("Retail or wholesale trade"), "Retail");
  assert.equal(normalizePhase2FieldOfWork("Unemployed, looking"), "I don't currently work");
});

test("normalizePhase2FieldOfWork passes already-matching labels through unchanged", () => {
  assert.equal(normalizePhase2FieldOfWork("Government"), "Government");
  assert.equal(normalizePhase2FieldOfWork("Healthcare"), "Healthcare");
  assert.equal(normalizePhase2FieldOfWork(""), "(not stated)");
});

test("buildFunnelCategories sorts by descending phase 1 count with pinned values last", () => {
  const phase1 = ["Bay Area", "Bay Area", "Los Angeles", "(not stated)", "I don't want to say"];
  const phase2 = ["Los Angeles", "Los Angeles", "Bay Area"];
  const categories = buildFunnelCategories(phase1, phase2);
  assert.deepEqual(
    categories.map((c) => c.name),
    ["Bay Area", "Los Angeles", "(not stated)", "I don't want to say"],
  );
});

test("buildFunnelCategories counts survey and attend independently", () => {
  const categories = buildFunnelCategories(["Bay Area", "Bay Area"], ["Bay Area"]);
  assert.deepEqual(categories, [{ name: "Bay Area", surveyCount: 2, attendCount: 1 }]);
});

test("buildFunnelCategories includes a category only seen in phase 2", () => {
  const categories = buildFunnelCategories(["Bay Area"], ["Sierra Region"]);
  const sierra = categories.find((c) => c.name === "Sierra Region");
  assert.deepEqual(sierra, { name: "Sierra Region", surveyCount: 0, attendCount: 1 });
});

test("buildFunnelSessions groups by date, not by session id", () => {
  const attendees = [
    { date: "2026-08-04", region: "Bay Area", fieldOfWork: "Government" },
    { date: "2026-08-04", region: "Los Angeles", fieldOfWork: "Government" },
    { date: "2026-07-09", region: "Bay Area", fieldOfWork: "Government" },
  ];
  const sessions = buildFunnelSessions(attendees);
  assert.deepEqual(
    sessions.map((s) => [s.date, s.attendees.length]),
    [["2026-07-09", 1], ["2026-08-04", 2]],
  );
});

test("buildFunnelSessions sorts sessions chronologically by date, not by attendee count", () => {
  const attendees = [
    { date: "2026-08-04", region: "Bay Area", fieldOfWork: "Government" },
    { date: "2026-07-09", region: "Bay Area", fieldOfWork: "Government" },
    { date: "2026-07-09", region: "Los Angeles", fieldOfWork: "Government" },
  ];
  const sessions = buildFunnelSessions(attendees);
  assert.deepEqual(sessions.map((s) => s.date), ["2026-07-09", "2026-08-04"]);
});

test("buildFunnelSessions keeps each attendee's region and field of work paired, not as independent marginals", () => {
  const attendees = [
    { date: "d1", region: "Los Angeles", fieldOfWork: "Government" },
    { date: "d1", region: "Bay Area", fieldOfWork: "Healthcare" },
  ];
  const sessions = buildFunnelSessions(attendees);
  assert.deepEqual(sessions[0].attendees, [
    { region: "Los Angeles", fieldOfWork: "Government" },
    { region: "Bay Area", fieldOfWork: "Healthcare" },
  ]);
});

test("buildFunnelData wires phase 1 rows and phase 2 attendee rows into one export", () => {
  const phase1Rows = [
    { REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" },
    { REGION: "Los Angeles", FIELD_OF_WORK_ROLLUP: "Good producing and harvesting" },
  ];
  const phase2Rows = [
    {
      SESSION_DATE: "2026-08-04",
      REGION: "Bay Area",
      FIELD_OF_WORK_SORTITION_GROUPING: "Government",
    },
  ];

  const funnel = buildFunnelData(phase1Rows, phase2Rows);

  assert.equal(funnel.phase1Total, 2);
  assert.deepEqual(
    funnel.regions.map((r) => [r.name, r.surveyCount, r.attendCount]),
    [["Bay Area", 1, 1], ["Los Angeles", 1, 0]],
  );
  const goodsProducing = funnel.fieldOfWork.find((f) => f.name === "Goods producing and harvesting");
  assert.equal(goodsProducing?.surveyCount, 1);
  assert.equal(funnel.sessions.length, 1);
  assert.equal(funnel.sessions[0].attendees.length, 1);
});

test("parseSortitionInvited reads Answer -> Invited count, stripping comma separators", () => {
  const rows = [
    { Answer: "Los Angeles", "Invited count": "1,246" },
    { Answer: "Bay Area", "Invited count": "201" },
  ];
  const invited = parseSortitionInvited(rows);
  assert.equal(invited.get("Los Angeles"), 1246);
  assert.equal(invited.get("Bay Area"), 201);
});

test("buildFunnelData excludes phase 1 rows with a blank REGION from phase1Total and every region's surveyCount", () => {
  const phase1Rows = [
    { REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" },
    { REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" },
    { REGION: "", FIELD_OF_WORK_ROLLUP: "Government" },
  ];
  const funnel = buildFunnelData(phase1Rows, []);
  assert.equal(funnel.phase1Total, 2);
  const bayArea = funnel.regions.find((r) => r.name === "Bay Area");
  assert.equal(bayArea?.surveyCount, 2);
  assert.equal(funnel.regions.some((r) => r.name === "(not stated)"), false);
});

test("buildFunnelData floors a region's invited quota at its attendCount when sortition data is absent or lower", () => {
  const phase1Rows = [{ REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" }];
  const phase2Rows = [
    { SESSION_DATE: "2026-08-04", REGION: "", FIELD_OF_WORK_SORTITION_GROUPING: "Government" },
    { SESSION_DATE: "2026-08-04", REGION: "", FIELD_OF_WORK_SORTITION_GROUPING: "Government" },
  ];
  const sortitionRows: Record<string, string>[] = [];
  const funnel = buildFunnelData(phase1Rows, phase2Rows, sortitionRows);
  const notStated = funnel.invitedByRegion.find((r) => r.name === "(not stated)");
  assert.equal(notStated?.count, 2, "2 attendees with no stated region floor their region's quota at 2");
});

test("buildFunnelData's invitedTotal sums every region's floored quota", () => {
  const phase1Rows = [
    { REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" },
    { REGION: "Los Angeles", FIELD_OF_WORK_ROLLUP: "Government" },
  ];
  const phase2Rows = [
    { SESSION_DATE: "2026-08-04", REGION: "Bay Area", FIELD_OF_WORK_SORTITION_GROUPING: "Government" },
    { SESSION_DATE: "2026-08-04", REGION: "", FIELD_OF_WORK_SORTITION_GROUPING: "Government" },
  ];
  const sortitionRows = [{ Answer: "Bay Area", "Invited count": "201" }];
  const funnel = buildFunnelData(phase1Rows, phase2Rows, sortitionRows);
  // Bay Area: max(201, 1) = 201. Los Angeles: max(0, 0) = 0. (not stated): max(0, 1) = 1.
  assert.equal(funnel.invitedTotal, 202);
});

test("buildFunnelData throws when a sortition Answer doesn't match any region name in the export", () => {
  const phase1Rows = [{ REGION: "Bay Area", FIELD_OF_WORK_ROLLUP: "Government" }];
  const sortitionRows = [{ Answer: "Bay Areaa", "Invited count": "201" }];
  assert.throws(() => buildFunnelData(phase1Rows, [], sortitionRows), /Bay Areaa/);
});
