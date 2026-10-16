import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoomsData,
  buildRoomIdeaText,
  parseUnitCount,
  parseSubthemeLabel,
  normalizeSessionNumber,
  parseSessionDate,
  THEMES_SHEET,
  IDEAS_SHEET,
  LOOKUP_SHEET,
} from "../src/lib/roomsData.ts";

const THEMES_HEADER = ["Theme", "Subtheme", "Policy concept", "Sessions", "Votes", "Ideas", "Top ideas"];
const IDEAS_HEADER = [
  "Session #",
  "Government Action / Idea",
  "Votes",
  "Meeting Date",
  "Session participant count",
  "Vote ratio",
  "Reworded for clarity (by Wes, Streamlit)",
];
const LOOKUP_HEADER = ["Session #", "Date & Time", "Date only", "Attendee count"];

const OPTS = { sourceFile: "../data/fixture.xlsx", sourceHash: "deadbeef" };

// --- A small, internally-consistent workbook, used by every test that needs
// a full buildRoomsData() call rather than testing one parser in isolation.
// One theme, one subtheme (no reconciliation mismatch), one concept, two
// sessions with idea rows whose participant counts agree with `lookup`.
function minimalSheets(): Map<string, string[][]> {
  const themes = [
    THEMES_HEADER,
    ["Protecting people's way of life", "A subtheme (2 sessions; 10 votes; 2 policy ideas)", "A concept", "2 sessions", "10 votes", "2 policy ideas", "1 top ideas"],
  ];
  const ideas = [
    IDEAS_HEADER,
    ["1", "Idea one", "6", "46212", "5", "1.2", ""],
    ["2", "Idea two", "4", "46218", "6", "0.66", ""],
  ];
  const lookup = [
    LOOKUP_HEADER,
    ["1", "Thu, 7/9/2026, 1:00 PM", "46212", "5"],
    ["2", "46218.4166666666", "46218", "6"],
  ];
  return new Map([
    [THEMES_SHEET, themes],
    [IDEAS_SHEET, ideas],
    [LOOKUP_SHEET, lookup],
  ]);
}

// ---------------------------------------------------------------------------
// Small pure parsers
// ---------------------------------------------------------------------------

test("parseUnitCount strips units from every column D-G shape", () => {
  assert.equal(parseUnitCount("34 votes"), 34);
  assert.equal(parseUnitCount("8 policy ideas"), 8);
  assert.equal(parseUnitCount("3 top ideas"), 3);
  assert.equal(parseUnitCount("0 top ideas"), 0);
  assert.equal(parseUnitCount("6 sessions"), 6);
});

test("parseUnitCount throws when a count cell has no digits at all", () => {
  assert.throws(() => parseUnitCount("no number here"));
});

test("parseSubthemeLabel splits the bare name from its stated-count parenthetical", () => {
  const parsed = parseSubthemeLabel("Protecting jobs and employees (10 sessions; 74 votes; 19 policy ideas)");
  assert.deepEqual(parsed, { name: "Protecting jobs and employees", statedSessions: 10, statedVotes: 74, statedIdeas: 19 });
});

test("parseSubthemeLabel tolerates a label with no parenthetical", () => {
  const parsed = parseSubthemeLabel("Just a bare name");
  assert.deepEqual(parsed, { name: "Just a bare name", statedSessions: null, statedVotes: null, statedIdeas: null });
});

test("normalizeSessionNumber handles plain integer strings", () => {
  assert.equal(normalizeSessionNumber("1"), 1);
  assert.equal(normalizeSessionNumber("13"), 13);
});

test("normalizeSessionNumber handles the '14.0' formatting-drift case", () => {
  assert.equal(normalizeSessionNumber("14.0"), 14);
});

test("normalizeSessionNumber throws on unparseable input rather than returning NaN", () => {
  assert.throws(() => normalizeSessionNumber("not a number"));
});

test("parseSessionDate prefers a numeric Excel serial in dateOnly", () => {
  // 46212 is session 1's real serial (1899-12-30 epoch) — verified against
  // the workbook to land on 2026-07-09, the same day session 1's literal
  // Date & Time string names.
  assert.equal(parseSessionDate("46212"), "2026-07-09");
});

test("parseSessionDate falls back to a literal weekday-date string when dateOnly is blank", () => {
  assert.equal(parseSessionDate("", "Thu, 7/9/2026, 1:00 PM"), "2026-07-09");
});

test("parseSessionDate truncates a fractional (date+time) serial to the calendar day", () => {
  assert.equal(parseSessionDate("46218.416666666664"), "2026-07-15");
});

test("parseSessionDate throws when neither input is parseable", () => {
  assert.throws(() => parseSessionDate("", ""));
});

// ---------------------------------------------------------------------------
// Row filtering: leading note row tolerance
// ---------------------------------------------------------------------------

test("buildRoomIdeaText ignores a leading note row with a blank Session # but text in column B", () => {
  const sheets = minimalSheets();
  sheets.set(IDEAS_SHEET, [
    IDEAS_HEADER,
    ["", "built by Gemini from the source - check contents if it becomes a source of truth", "", "", "", "", ""],
    ["1", "Idea one", "6", "46212", "5", "1.2", ""],
    ["2", "Idea two", "4", "46218", "6", "0.66", ""],
  ]);
  const ideaText = buildRoomIdeaText(sheets);
  assert.equal(Object.keys(ideaText).length, 2);
  assert.equal(ideaText["I-001"], "Idea one");
});

test("buildRoomIdeaText works identically with no leading note row present", () => {
  const ideaText = buildRoomIdeaText(minimalSheets());
  assert.deepEqual(ideaText, { "I-001": "Idea one", "I-002": "Idea two" });
});

test("buildRoomIdeaText also tolerates a note row that has a Session # but blank idea text", () => {
  const sheets = minimalSheets();
  sheets.set(IDEAS_SHEET, [
    IDEAS_HEADER,
    ["1", "", "", "", "", "", ""],
    ["1", "Idea one", "6", "46212", "5", "1.2", ""],
    ["2", "Idea two", "4", "46218", "6", "0.66", ""],
  ]);
  const ideaText = buildRoomIdeaText(sheets);
  assert.equal(Object.keys(ideaText).length, 2);
});

// ---------------------------------------------------------------------------
// buildRoomsData integration behavior
// ---------------------------------------------------------------------------

test("buildRoomsData excludes a session with a date but blank attendee count (session 15's shape)", () => {
  const sheets = minimalSheets();
  const lookup = sheets.get(LOOKUP_SHEET)!;
  sheets.set(LOOKUP_SHEET, [...lookup, ["3", "46247.4166666666", "46247", ""]]);
  const data = buildRoomsData(sheets, OPTS);
  assert.equal(data.sessions.length, 2);
  assert.ok(!data.sessions.some((s) => s.number === 3));
  assert.equal(data.meta.sessions, 2);
});

test("buildRoomsData throws when lookup's Attendee count disagrees with the ideas sheet's Session participant count", () => {
  const sheets = minimalSheets();
  const ideas = sheets.get(IDEAS_SHEET)!;
  // Session 1's participant count is 5 everywhere else in the fixture;
  // corrupt just the lookup side to 99.
  sheets.set(LOOKUP_SHEET, [
    LOOKUP_HEADER,
    ["1", "Thu, 7/9/2026, 1:00 PM", "46212", "99"],
    ["2", "46218.4166666666", "46218", "6"],
  ]);
  sheets.set(IDEAS_SHEET, ideas);
  assert.throws(() => buildRoomsData(sheets, OPTS), /disagrees with the ideas sheet/);
});

test("buildRoomsData throws when a session's own idea rows disagree with each other on participant count", () => {
  const sheets = minimalSheets();
  sheets.set(IDEAS_SHEET, [
    IDEAS_HEADER,
    ["1", "Idea one", "6", "46212", "5", "1.2", ""],
    ["1", "Idea one-b", "3", "46212", "7", "0.4", ""], // same session, different participant count
    ["2", "Idea two", "4", "46218", "6", "0.66", ""],
  ]);
  assert.throws(() => buildRoomsData(sheets, OPTS), /disagree with each other/);
});

test("buildRoomsData assigns deterministic, zero-padded ids in sheet order", () => {
  const data = buildRoomsData(minimalSheets(), OPTS);
  assert.equal(data.themes[0].id, "T1");
  assert.equal(data.subthemes[0].id, "ST-01");
  assert.equal(data.concepts[0].id, "C-01");
  assert.deepEqual(data.sessions.map((s) => s.id), ["S01", "S02"]);
  assert.deepEqual(data.ideas.map((i) => i.id), ["I-001", "I-002"]);
});

test("buildRoomsData's idea ids correspond exactly to buildRoomIdeaText's keys for the same sheets", () => {
  const sheets = minimalSheets();
  const data = buildRoomsData(sheets, OPTS);
  const ideaText = buildRoomIdeaText(sheets);
  assert.deepEqual(Object.keys(ideaText).sort(), data.ideas.map((i) => i.id).sort());
  assert.equal(ideaText[data.ideas[0].id], "Idea one");
});

test("buildRoomsData computes voteRatio from votes/participantCount, not the sheet's own Vote ratio column", () => {
  const data = buildRoomsData(minimalSheets(), OPTS);
  // Session 1's row states votes=6, participant count=5, but a wrong
  // "Vote ratio" cell value of "1.2" (i.e. as if it read 6/5=1.2 - actually
  // correct here, so flip it to prove we don't just parse column F).
  const sheets = minimalSheets();
  sheets.set(IDEAS_SHEET, [
    IDEAS_HEADER,
    ["1", "Idea one", "6", "46212", "5", "999", ""], // bogus Vote ratio cell
    ["2", "Idea two", "4", "46218", "6", "999", ""],
  ]);
  const recomputed = buildRoomsData(sheets, OPTS);
  assert.equal(recomputed.ideas[0].voteRatio, 6 / 5);
  assert.equal(recomputed.ideas[1].voteRatio, 4 / 6);
  assert.notEqual(recomputed.ideas[0].voteRatio, 999);
  // sanity: the "normal" fixture agrees with its own Vote ratio column too.
  assert.equal(data.ideas[0].voteRatio, 6 / 5);
});

test("buildRoomsData leaves conceptId null and hasIdeaLinkage false (Task 6 not yet run)", () => {
  const data = buildRoomsData(minimalSheets(), OPTS);
  assert.equal(data.meta.hasIdeaLinkage, false);
  assert.ok(data.ideas.every((i) => i.conceptId === null));
});

test("buildRoomsData fills meta.sourceFile/sourceHash from the caller's options, not by reading anything itself", () => {
  const data = buildRoomsData(minimalSheets(), { sourceFile: "../data/some-other-name.xlsx", sourceHash: "abc123" });
  assert.equal(data.meta.sourceFile, "../data/some-other-name.xlsx");
  assert.equal(data.meta.sourceHash, "abc123");
});

test("buildRoomsData produces no reconciliation entries when the two sheets already agree", () => {
  const data = buildRoomsData(minimalSheets(), OPTS);
  assert.deepEqual(data.meta.reconciliation, []);
});

// ---------------------------------------------------------------------------
// The three known real-workbook inconsistencies, reproduced with the exact
// aggregate figures verified against the workbook during planning (see
// the internal analysis notes): sheet 2 has 157 idea rows / 519 votes; sheet 1's
// concept rows sum to 149 ideas / 518 votes; and the "Empowering people to
// protect their data" subtheme states 82 votes / 24 ideas but its own
// concept rows sum to 94 votes / 26 ideas (the only subtheme where stated
// and summed disagree). Idea *text* here is synthetic filler ("Idea 0", …)
// rather than real participant text, per the README's data rule against ever
// committing response text — only the counts need to be real.
// ---------------------------------------------------------------------------

function realNumbersSheets(): Map<string, string[][]> {
  const themes = [
    THEMES_HEADER,
    // The one mismatching subtheme: stated 82 votes / 24 ideas, but its two
    // concept rows sum to 94 votes / 26 ideas.
    [
      "Protecting people's way of life",
      "Empowering people to protect their data (9 sessions; 82 votes; 24 policy ideas)",
      "Concept A",
      "5 sessions",
      "50 votes",
      "13 policy ideas",
      "2 top ideas",
    ],
    [
      "Protecting people's way of life",
      "Empowering people to protect their data (9 sessions; 82 votes; 24 policy ideas)",
      "Concept B",
      "4 sessions",
      "44 votes",
      "13 policy ideas",
      "1 top ideas",
    ],
    // A second subtheme whose stated and summed counts agree exactly, to
    // prove the "only the one subtheme" check doesn't over-fire. Carries
    // the remainder needed to hit the workbook's real 149-idea/518-vote
    // concept-row totals: 149-26=123 ideas, 518-94=424 votes.
    [
      "Protecting people's way of life",
      "Matching subtheme (1 sessions; 424 votes; 123 policy ideas)",
      "Concept C",
      "1 sessions",
      "424 votes",
      "123 policy ideas",
      "0 top ideas",
    ],
  ];

  // Sheet 2: 157 idea rows summing to 519 votes total, all under one
  // session so the fixture stays small; distribution of votes across rows
  // is arbitrary (only the totals are asserted against), but the total row
  // count (157) and total votes (519) are the real, verified numbers.
  const ideaRows: string[][] = [];
  for (let i = 0; i < 157; i++) {
    const votes = i === 0 ? 519 - 156 : 1; // 363 + 156*1 = 519
    ideaRows.push([String(1), `Idea ${i}`, String(votes), "46212", "5", "", ""]);
  }
  const ideas = [IDEAS_HEADER, ...ideaRows];

  const lookup = [LOOKUP_HEADER, ["1", "Thu, 7/9/2026, 1:00 PM", "46212", "5"]];

  return new Map([
    [THEMES_SHEET, themes],
    [IDEAS_SHEET, ideas],
    [LOOKUP_SHEET, lookup],
  ]);
}

test("buildRoomsData reports the workbook's ideas total (157 vs 149) as a reconciliation entry", () => {
  const data = buildRoomsData(realNumbersSheets(), OPTS);
  const entry = data.meta.reconciliation.find((e) => e.scope === "workbook" && e.field === "ideas");
  assert.ok(entry, "expected a workbook/ideas reconciliation entry");
  assert.equal(entry!.stated, 149);
  assert.equal(entry!.computed, 157);
  assert.equal(data.meta.ideas, 157); // meta.ideas is sheet 2's authoritative count
});

test("buildRoomsData reports the workbook's votes total (519 vs 518) as a reconciliation entry", () => {
  const data = buildRoomsData(realNumbersSheets(), OPTS);
  const entry = data.meta.reconciliation.find((e) => e.scope === "workbook" && e.field === "votes");
  assert.ok(entry, "expected a workbook/votes reconciliation entry");
  assert.equal(entry!.stated, 518);
  assert.equal(entry!.computed, 519);
  assert.equal(data.meta.votes, 519);
});

test("buildRoomsData reports the 'Empowering people to protect their data' subtheme mismatch as two separate entries (votes and ideas)", () => {
  const data = buildRoomsData(realNumbersSheets(), OPTS);
  const votesEntry = data.meta.reconciliation.find(
    (e) => e.scope === "Empowering people to protect their data" && e.field === "votes",
  );
  const ideasEntry = data.meta.reconciliation.find(
    (e) => e.scope === "Empowering people to protect their data" && e.field === "ideas",
  );
  assert.ok(votesEntry, "expected a subtheme-scoped votes reconciliation entry");
  assert.equal(votesEntry!.stated, 82);
  assert.equal(votesEntry!.computed, 94);

  // This subtheme disagrees on ideas too (24 stated vs 26 summed) — every
  // stated-vs-recomputed disagreement gets its own entry, not just the
  // first one found, so this is a *second*, independent entry, not folded
  // into the votes entry above.
  assert.ok(ideasEntry, "expected a subtheme-scoped ideas reconciliation entry");
  assert.equal(ideasEntry!.stated, 24);
  assert.equal(ideasEntry!.computed, 26);

  const subtheme = data.subthemes.find((s) => s.name === "Empowering people to protect their data")!;
  assert.equal(subtheme.statedIdeas, 24);
  assert.equal(subtheme.ideas, 26);
});

test("classifying the real workbook's known inconsistencies produces exactly four reconciliation entries, and does not throw", () => {
  assert.doesNotThrow(() => {
    const data = buildRoomsData(realNumbersSheets(), OPTS);
    // 2 workbook-level (ideas, votes) + 2 for the one subtheme that
    // disagrees on both of its own fields (votes, ideas) = 4.
    assert.equal(data.meta.reconciliation.length, 4);
  });
});

test("a subtheme that disagrees on only one field produces exactly one reconciliation entry, not two", () => {
  // Regression guard for the independent-if-statements fix: a subtheme
  // whose votes match but whose ideas don't (or vice versa) must not somehow
  // produce a phantom second entry for the field that actually agrees.
  const sheets = realNumbersSheets();
  const themes = sheets.get(THEMES_SHEET)!;
  // Rewrite the "Empowering..." subtheme's two concept rows so votes now
  // matches its stated count (82) but ideas still doesn't (still sums to 26
  // against a stated 24).
  sheets.set(THEMES_SHEET, [
    themes[0],
    [
      "Protecting people's way of life",
      "Empowering people to protect their data (9 sessions; 82 votes; 24 policy ideas)",
      "Concept A",
      "5 sessions",
      "38 votes",
      "13 policy ideas",
      "2 top ideas",
    ],
    [
      "Protecting people's way of life",
      "Empowering people to protect their data (9 sessions; 82 votes; 24 policy ideas)",
      "Concept B",
      "4 sessions",
      "44 votes",
      "13 policy ideas",
      "1 top ideas",
    ],
    themes[3],
  ]);
  const data = buildRoomsData(sheets, OPTS);
  const entries = data.meta.reconciliation.filter((e) => e.scope === "Empowering people to protect their data");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].field, "ideas");
});

test("the other (matching) subtheme in the real-numbers fixture produces no reconciliation entry of its own", () => {
  const data = buildRoomsData(realNumbersSheets(), OPTS);
  const entries = data.meta.reconciliation.filter((e) => e.scope === "Matching subtheme");
  assert.deepEqual(entries, []);
});
