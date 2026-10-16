import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  clusterLabelsIntoColumns,
  assignStickyToLabel,
  labelConceptName,
  normalizeIdeaText,
  buildIdeaTextIndex,
  matchStickyToIdeaId,
  linkIdeasViaFigjam,
  type FigjamLabel,
  type FigjamSticky,
  type FigjamExtract,
} from "../src/lib/figjamLinkage.ts";

function makeLabel(overrides: Partial<FigjamLabel>): FigjamLabel {
  return {
    id: "L-1",
    text: "A concept (1 sessions; 1 votes; 1 policy ideas; 0 top ideas)",
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    sectionId: "S-1",
    level: "concept",
    ...overrides,
  };
}

function makeSticky(overrides: Partial<FigjamSticky>): FigjamSticky {
  return {
    id: "K-1",
    text: "An idea",
    x: 0,
    y: 0,
    width: 240,
    height: 240,
    color: "STICKY_GREEN",
    sectionId: "S-1",
    ...overrides,
  };
}

// --- clusterLabelsIntoColumns -------------------------------------------------

test("clusterLabelsIntoColumns groups labels within the threshold into one column", () => {
  const labels = [
    makeLabel({ id: "L-1", x: 100, y: 500 }),
    makeLabel({ id: "L-2", x: 120, y: 100 }),
  ];
  const cols = clusterLabelsIntoColumns(labels);
  const sectionCols = cols.get("S-1")!;
  assert.equal(sectionCols.length, 1);
  // sorted by y ascending within the column
  assert.deepEqual(sectionCols[0].labels.map((l) => l.id), ["L-2", "L-1"]);
});

test("clusterLabelsIntoColumns splits labels far apart in x into separate columns", () => {
  const labels = [makeLabel({ id: "L-1", x: 100 }), makeLabel({ id: "L-2", x: 3000 })];
  const cols = clusterLabelsIntoColumns(labels);
  assert.equal(cols.get("S-1")!.length, 2);
});

test("clusterLabelsIntoColumns keeps different sections' columns independent", () => {
  const labels = [
    makeLabel({ id: "L-1", sectionId: "S-1", x: 100 }),
    makeLabel({ id: "L-2", sectionId: "S-2", x: 100 }),
  ];
  const cols = clusterLabelsIntoColumns(labels);
  assert.equal(cols.get("S-1")!.length, 1);
  assert.equal(cols.get("S-2")!.length, 1);
});

// --- assignStickyToLabel -------------------------------------------------

test("assignStickyToLabel picks the label directly above the sticky in the same column", () => {
  const labels = [
    makeLabel({ id: "L-top", x: 100, y: 0 }),
    makeLabel({ id: "L-mid", x: 100, y: 1000 }),
  ];
  const cols = clusterLabelsIntoColumns(labels);
  const sticky = makeSticky({ x: 100, y: 1200 }); // below L-mid, same column
  const result = assignStickyToLabel(sticky, cols);
  assert.equal(result?.id, "L-mid");
});

test("assignStickyToLabel falls back to a column's topmost label when the sticky sits above every label", () => {
  const labels = [makeLabel({ id: "L-only", x: 100, y: 1000 })];
  const cols = clusterLabelsIntoColumns(labels);
  const sticky = makeSticky({ x: 100, y: 0 });
  const result = assignStickyToLabel(sticky, cols);
  assert.equal(result?.id, "L-only");
});

test("assignStickyToLabel chooses the nearest column by x, not just the first one found", () => {
  const labels = [
    makeLabel({ id: "L-near-col-b", x: 3000, y: 0 }),
    makeLabel({ id: "L-col-a", x: 0, y: 0 }),
  ];
  const cols = clusterLabelsIntoColumns(labels);
  const sticky = makeSticky({ x: 2950, y: 500 }); // much closer to column at x=3000
  const result = assignStickyToLabel(sticky, cols);
  assert.equal(result?.id, "L-near-col-b");
});

test("assignStickyToLabel returns null when the sticky's section has no labels", () => {
  const cols = clusterLabelsIntoColumns([makeLabel({ sectionId: "OTHER-SECTION" })]);
  const sticky = makeSticky({ sectionId: "S-1" });
  assert.equal(assignStickyToLabel(sticky, cols), null);
});

// --- labelConceptName -----------------------------------------------------

test("labelConceptName strips the stated-stats suffix", () => {
  assert.equal(
    labelConceptName("Control how AI works (8 sessions; 23 votes; 8 policy ideas; 2 top ideas)"),
    "Control how AI works",
  );
});

test("labelConceptName leaves a name with no stats suffix untouched", () => {
  assert.equal(labelConceptName("Just a name"), "Just a name");
});

// --- normalizeIdeaText -----------------------------------------------------

test("normalizeIdeaText strips a trailing parenthesized vote count", () => {
  assert.equal(normalizeIdeaText("Ban AI in hiring decisions (8)"), "ban ai in hiring decisions");
});

test("normalizeIdeaText strips a trailing dash vote count", () => {
  assert.equal(normalizeIdeaText("Ban AI in hiring decisions - 8"), "ban ai in hiring decisions");
});

test("normalizeIdeaText is case-insensitive and collapses punctuation", () => {
  assert.equal(normalizeIdeaText("Require Warrants — for Data!"), "require warrants for data");
});

// --- buildIdeaTextIndex / matchStickyToIdeaId -------------------------------

test("matchStickyToIdeaId finds a unique match", () => {
  const index = buildIdeaTextIndex({ "I-001": "Ban AI in hiring decisions (8)" });
  const result = matchStickyToIdeaId("Ban AI in hiring decisions - 8", index);
  assert.equal(result.matchedIdeaId, "I-001");
  assert.equal(result.ambiguous, false);
});

test("matchStickyToIdeaId reports ambiguous when two ideas normalize the same", () => {
  const index = buildIdeaTextIndex({
    "I-001": "Ban AI in hiring decisions (8)",
    "I-002": "ban ai in hiring decisions - 3",
  });
  const result = matchStickyToIdeaId("Ban AI in hiring decisions", index);
  assert.equal(result.matchedIdeaId, null);
  assert.equal(result.ambiguous, true);
});

test("matchStickyToIdeaId returns no match, not ambiguous, when nothing matches", () => {
  const index = buildIdeaTextIndex({ "I-001": "Something else entirely" });
  const result = matchStickyToIdeaId("Ban AI in hiring decisions", index);
  assert.equal(result.matchedIdeaId, null);
  assert.equal(result.ambiguous, false);
});

// --- linkIdeasViaFigjam (end-to-end on a small synthetic board) ------------

test("linkIdeasViaFigjam links a sticky to the idea id and concept name when both steps succeed", () => {
  const extract: FigjamExtract = {
    labels: [
      makeLabel({
        id: "L-1",
        text: "Control how AI works (1 sessions; 1 votes; 1 policy ideas; 0 top ideas)",
        x: 100,
        y: 0,
      }),
    ],
    stickies: [makeSticky({ id: "K-1", text: "Ban AI in hiring decisions - 8", x: 100, y: 500 })],
  };
  const result = linkIdeasViaFigjam(extract, { "I-001": "Ban AI in hiring decisions (8)" });
  assert.deepEqual(result.linked, [{ ideaId: "I-001", conceptName: "Control how AI works" }]);
  assert.deepEqual(result.unmatchedStickies, []);
});

test("linkIdeasViaFigjam reports no-text-match when the sticky's text matches no idea", () => {
  const extract: FigjamExtract = {
    labels: [makeLabel({ id: "L-1", x: 100, y: 0 })],
    stickies: [makeSticky({ id: "K-1", text: "Nothing like it", x: 100, y: 500 })],
  };
  const result = linkIdeasViaFigjam(extract, { "I-001": "Completely different idea" });
  assert.equal(result.linked.length, 0);
  assert.equal(result.unmatchedStickies.length, 1);
  assert.equal(result.unmatchedStickies[0].reason, "no-text-match");
});

// --- Real-data regression: the actual frozen board snapshot ------------------

// Needs the real roomIdeas.json AND the original (non-synthetic) board text.
const REAL_BOARD =
  existsSync("artifacts/viz/roomIdeas.json") &&
  !readFileSync("config/figjam-idea-concept-map.json", "utf8").includes("[SYNTHETIC]");

test("linkIdeasViaFigjam against the real frozen board snapshot resolves the large majority of stickies with zero ambiguous collisions", { skip: !REAL_BOARD && "real board text / roomIdeas.json not present" }, () => {
  const extract: FigjamExtract = JSON.parse(readFileSync("config/figjam-idea-concept-map.json", "utf8"));
  const roomIdeaText: Record<string, string> = JSON.parse(readFileSync("artifacts/viz/roomIdeas.json", "utf8"));

  const result = linkIdeasViaFigjam(extract, roomIdeaText);

  assert.ok(result.linked.length >= 120, `expected at least 120 linked ideas, got ${result.linked.length}`);
  const ambiguousCount = result.unmatchedStickies.filter((u) => u.reason === "ambiguous-text-match").length;
  assert.equal(ambiguousCount, 0, "expected zero ambiguous text-match collisions on the real board");
});
