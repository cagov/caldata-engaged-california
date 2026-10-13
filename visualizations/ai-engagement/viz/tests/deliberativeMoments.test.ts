import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentRankInc,
  compositeOrder,
  buildMomentGroups,
  attributionFor,
  placeholderQuoteFor,
  displayNameFor,
  cardQuotesFor,
  PLACEHOLDER_QUOTES,
  type MomentConcept,
  type MomentSession,
} from "../src/lib/deliberativeMoments.ts";
import type { RoomsData, RoomsConcept } from "../src/lib/roomsData.ts";
import type { Cluster } from "../src/lib/funnelCloud.ts";
import type { ConceptInsight } from "../src/lib/insightsData.ts";

// The real 29 rooms.json concepts' aggregate counts (sessions/votes/ideas/
// topIdeas) — no response text, just the published counts — copied at
// authoring time so this test is a self-contained regression guard on the
// reference sheet's own ordering, not a live read of the gitignored
// analysis/artifacts/viz/rooms.json (which may not exist on a fresh clone;
// every other viz/ test fixture is self-contained the same way).
const REAL_CONCEPTS: RoomsConcept[] = [
  { id: "C-01", subthemeId: "ST-01", themeId: "T1", name: "Incentivize keeping or adding jobs; prevent firing", sessions: 6, votes: 34, ideas: 8, topIdeas: 3 },
  { id: "C-02", subthemeId: "ST-01", themeId: "T1", name: "Shift or reskill employees", sessions: 5, votes: 20, ideas: 5, topIdeas: 4 },
  { id: "C-03", subthemeId: "ST-01", themeId: "T1", name: "Support workers who lose jobs due to AI", sessions: 2, votes: 9, ideas: 2, topIdeas: 2 },
  { id: "C-04", subthemeId: "ST-01", themeId: "T1", name: "Prohibit firing employees for not using AI", sessions: 2, votes: 6, ideas: 2, topIdeas: 0 },
  { id: "C-05", subthemeId: "ST-01", themeId: "T1", name: "Report on job loss due to AI", sessions: 1, votes: 3, ideas: 1, topIdeas: 0 },
  { id: "C-06", subthemeId: "ST-01", themeId: "T1", name: "Use AI for jobs people don’t want to or can’t do", sessions: 1, votes: 2, ideas: 1, topIdeas: 0 },
  { id: "C-07", subthemeId: "ST-02", themeId: "T1", name: "Ensure companies use data properly and transparently", sessions: 5, votes: 38, ideas: 11, topIdeas: 4 },
  { id: "C-08", subthemeId: "ST-02", themeId: "T1", name: "Preserve privacy", sessions: 3, votes: 25, ideas: 6, topIdeas: 1 },
  { id: "C-09", subthemeId: "ST-02", themeId: "T1", name: "Limit data collection", sessions: 4, votes: 17, ideas: 4, topIdeas: 3 },
  { id: "C-10", subthemeId: "ST-02", themeId: "T1", name: "Allow people to opt-out of AI", sessions: 4, votes: 14, ideas: 5, topIdeas: 0 },
  { id: "C-11", subthemeId: "ST-03", themeId: "T1", name: "Disclosing or labelling when AI is used", sessions: 7, votes: 30, ideas: 9, topIdeas: 2 },
  { id: "C-12", subthemeId: "ST-03", themeId: "T1", name: "Keeping humans in the loop", sessions: 3, votes: 10, ideas: 3, topIdeas: 0 },
  { id: "C-13", subthemeId: "ST-03", themeId: "T1", name: "Promoting access to life outside of AI", sessions: 3, votes: 7, ideas: 4, topIdeas: 0 },
  { id: "C-14", subthemeId: "ST-03", themeId: "T1", name: "Defining AI vs. humans", sessions: 1, votes: 2, ideas: 1, topIdeas: 0 },
  { id: "C-15", subthemeId: "ST-04", themeId: "T1", name: "Improve education for students about AI", sessions: 4, votes: 14, ideas: 4, topIdeas: 2 },
  { id: "C-16", subthemeId: "ST-04", themeId: "T1", name: "Prevent students from using AI for school work", sessions: 3, votes: 9, ideas: 3, topIdeas: 0 },
  { id: "C-17", subthemeId: "ST-04", themeId: "T1", name: "Require parental controls for AI use", sessions: 2, votes: 8, ideas: 2, topIdeas: 1 },
  { id: "C-18", subthemeId: "ST-05", themeId: "T1", name: "Enable more public input on AI policy", sessions: 6, votes: 27, ideas: 8, topIdeas: 3 },
  { id: "C-19", subthemeId: "ST-05", themeId: "T1", name: "Ensure communities have input on AI-related impacts", sessions: 2, votes: 11, ideas: 2, topIdeas: 2 },
  { id: "C-20", subthemeId: "ST-06", themeId: "T2", name: "Determine fields/areas where AI can be used safely", sessions: 7, votes: 31, ideas: 9, topIdeas: 4 },
  { id: "C-21", subthemeId: "ST-06", themeId: "T2", name: "Control how AI works", sessions: 8, votes: 23, ideas: 8, topIdeas: 2 },
  { id: "C-22", subthemeId: "ST-06", themeId: "T2", name: "Enforce copyright protections", sessions: 4, votes: 20, ideas: 5, topIdeas: 3 },
  { id: "C-23", subthemeId: "ST-06", themeId: "T2", name: "Use AI to improve government operations", sessions: 3, votes: 20, ideas: 5, topIdeas: 1 },
  { id: "C-24", subthemeId: "ST-06", themeId: "T2", name: "Restrict AI companies’ profits", sessions: 5, votes: 18, ideas: 6, topIdeas: 2 },
  { id: "C-25", subthemeId: "ST-07", themeId: "T2", name: "Hold AI companies accountable for protecting consumers", sessions: 7, votes: 37, ideas: 11, topIdeas: 4 },
  { id: "C-26", subthemeId: "ST-07", themeId: "T2", name: "Protect the environment and consumers from the resource needs of data centers", sessions: 6, votes: 35, ideas: 8, topIdeas: 4 },
  { id: "C-27", subthemeId: "ST-08", themeId: "T3", name: "Increase public awareness around how to use AI ethically", sessions: 7, votes: 21, ideas: 7, topIdeas: 0 },
  { id: "C-28", subthemeId: "ST-08", themeId: "T3", name: "Do more research on AI", sessions: 4, votes: 18, ideas: 6, topIdeas: 3 },
  { id: "C-29", subthemeId: "ST-08", themeId: "T3", name: "Create employee training about AI", sessions: 3, votes: 9, ideas: 3, topIdeas: 1 },
];

function roomsFixture(concepts: RoomsConcept[], ideas: RoomsData["ideas"] = [], sessions: RoomsData["sessions"] = []): RoomsData {
  return {
    meta: {
      generated: "",
      sourceFile: "",
      sourceHash: "",
      sessions: sessions.length,
      attendees: 0,
      ideas: ideas.length,
      votes: 0,
      sampleCaveat: "",
      reconciliation: [],
      hasIdeaLinkage: true,
      linkageCoverage: 1,
    },
    themes: [],
    subthemes: [],
    concepts,
    sessions,
    ideas,
  };
}

test("percentRankInc: minimum scores 0, maximum scores 1", () => {
  assert.equal(percentRankInc([1, 5, 10], 1), 0);
  assert.equal(percentRankInc([1, 5, 10], 10), 1);
});

test("percentRankInc: a tie takes the lowest matching sorted index", () => {
  // sorted [1, 5, 5, 10] — both 5s rank at index 1 of 3, i.e. 1/3
  assert.equal(percentRankInc([1, 5, 5, 10], 5), 1 / 3);
});

test("percentRankInc: interpolates between the two bracketing values when v isn't present", () => {
  assert.equal(percentRankInc([0, 10], 5), 0.5);
});

test("percentRankInc: clamps to 0/1 for a v outside the array's range rather than NaN", () => {
  assert.equal(percentRankInc([2, 4, 6], 0), 0);
  assert.equal(percentRankInc([2, 4, 6], 100), 1);
});

test("compositeOrder reproduces the reference sheet's own percentrank ordering to 4 decimal places", () => {
  // Verified against data/Copy of Policy ideas with votes ... .csv's own
  // "Composite metric order (percentrank session% + percentrank top)"
  // column for these concept ids.
  const order = compositeOrder(REAL_CONCEPTS);
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  assert.equal(round4(order.get("C-25")!), 0.8571); // Hold AI companies accountable
  assert.equal(round4(order.get("C-20")!), 0.8571); // Determine fields/areas where AI can be used safely
  assert.equal(round4(order.get("C-26")!), 0.8036); // Protect the environment and consumers
  assert.equal(round4(order.get("C-07")!), 0.75); // Ensure companies use data properly and transparently
  assert.equal(round4(order.get("C-02")!), 0.75); // Shift or reskill employees
  assert.equal(round4(order.get("C-21")!), 0.7321); // Control how AI works
  assert.equal(round4(order.get("C-11")!), 0.6607); // Disclosing or labelling when AI is used
  assert.equal(round4(order.get("C-24")!), 0.5536); // Restrict AI companies' profits
  assert.equal(round4(order.get("C-04")!), 0.0536); // Prohibit firing employees for not using AI
  assert.equal(round4(order.get("C-05")!), 0); // Report on job loss due to AI
  assert.equal(round4(order.get("C-06")!), 0); // Use AI for jobs people don't want to or can't do
  assert.equal(round4(order.get("C-14")!), 0); // Defining AI vs. humans
});

test("buildMomentGroups bins all 29 real concepts with zero left unbinned, sizes 9/6/10/4", () => {
  const groups = buildMomentGroups(roomsFixture(REAL_CONCEPTS), []);
  const sizes = new Map(groups.map((g) => [g.key, g.concepts.length]));
  assert.equal(sizes.get("most popular"), 9);
  assert.equal(sizes.get("popular"), 6);
  assert.equal(sizes.get("less popular"), 10);
  assert.equal(sizes.get("least popular"), 4);
  const total = groups.reduce((sum, g) => sum + g.concepts.length, 0);
  assert.equal(total, REAL_CONCEPTS.length);
});

test("buildMomentGroups' most-popular bin matches the reference sheet's top two rows", () => {
  const groups = buildMomentGroups(roomsFixture(REAL_CONCEPTS), []);
  const mostPopular = groups.find((g) => g.key === "most popular")!;
  assert.deepEqual(
    mostPopular.concepts.slice(0, 2).map((c) => c.name),
    ["Determine fields/areas where AI can be used safely", "Hold AI companies accountable for protecting consumers"],
  );
});

test("buildMomentGroups sorts within a bin by order descending, ties alphabetical by name", () => {
  const groups = buildMomentGroups(roomsFixture(REAL_CONCEPTS), []);
  const mostPopular = groups.find((g) => g.key === "most popular")!;
  for (let i = 1; i < mostPopular.concepts.length; i++) {
    const prev = mostPopular.concepts[i - 1];
    const cur = mostPopular.concepts[i];
    assert.ok(prev.order > cur.order || (prev.order === cur.order && prev.name.localeCompare(cur.name) <= 0));
  }
});

// --- Session-join mechanics, on a small synthetic fixture (mirrors
// funnelCloud.test.ts's fixtureData() convention) rather than the real
// idea-level linkage, so this stays a deterministic unit test of the join
// logic itself, not a brittle snapshot of a table the analysis pipeline can
// still revise (concept ids/vote sums may shift as s16-figjam-linkage.ts's
// matching improves). The "does the live app show the exact right
// highlight count" check belongs to the plan's manual verification step,
// not this file.
function joinFixture() {
  const concepts: RoomsConcept[] = [
    { id: "C-A", subthemeId: "ST-A", themeId: "T1", name: "Concept A", sessions: 2, votes: 10, ideas: 3, topIdeas: 2 },
    { id: "C-B", subthemeId: "ST-A", themeId: "T1", name: "Concept B", sessions: 1, votes: 4, ideas: 1, topIdeas: 0 },
  ];
  const ideas: RoomsData["ideas"] = [
    { id: "I-1", sessionNumber: 1, votes: 5, voteRatio: 1, conceptId: "C-A" },
    { id: "I-2", sessionNumber: 1, votes: 2, voteRatio: 0.4, conceptId: "C-A" },
    { id: "I-3", sessionNumber: 2, votes: 9, voteRatio: 1, conceptId: "C-A" },
    { id: "I-4", sessionNumber: 3, votes: 1, voteRatio: 1, conceptId: null }, // unlinked — never contributes
  ];
  const sessions: RoomsData["sessions"] = [
    { id: "S1", number: 1, date: "2026-07-01", attendees: 5, facilitators: 1, ideas: 2, votes: 7, votesPerAttendee: 1.4 },
    { id: "S2", number: 2, date: "2026-07-02", attendees: 4, facilitators: 1, ideas: 1, votes: 9, votesPerAttendee: 2.25 },
    { id: "S3", number: 3, date: "2026-07-03", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 0.33 },
  ];
  const clusters: Cluster[] = [
    { n: 4, rings: [], rc: 30, ang: 0, x: 0, y: 0, date: "2026-07-02", pulsePhase: 0, pulsePeriod: 1 }, // deliberately out of session-number order
    { n: 5, rings: [], rc: 30, ang: 1, x: 10, y: 10, date: "2026-07-01", pulsePhase: 0, pulsePeriod: 1 },
    { n: 3, rings: [], rc: 30, ang: 2, x: 20, y: 20, date: "2026-07-03", pulsePhase: 0, pulsePeriod: 1 },
  ];
  return { rooms: roomsFixture(concepts, ideas, sessions), clusters };
}

test("buildMomentGroups joins each contributing session to its cluster by date, not by array position", () => {
  const { rooms, clusters } = joinFixture();
  const groups = buildMomentGroups(rooms, clusters);
  const conceptA = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-A")!;
  // Session 1 -> clusters[1] (date 2026-07-01), session 2 -> clusters[0] (date 2026-07-02).
  const bySessionNumber = new Map(conceptA.contributing.map((s) => [s.sessionNumber, s]));
  assert.equal(bySessionNumber.get(1)!.clusterIndex, 1);
  assert.equal(bySessionNumber.get(2)!.clusterIndex, 0);
});

test("buildMomentGroups sums votes and counts linked ideas per contributing session", () => {
  const { rooms, clusters } = joinFixture();
  const groups = buildMomentGroups(rooms, clusters);
  const conceptA = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-A")!;
  const session1 = conceptA.contributing.find((s) => s.sessionNumber === 1)!;
  assert.equal(session1.linkedIdeas, 2);
  assert.equal(session1.votes, 7); // 5 + 2
});

test("buildMomentGroups sorts contributing sessions by votes descending", () => {
  const { rooms, clusters } = joinFixture();
  const groups = buildMomentGroups(rooms, clusters);
  const conceptA = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-A")!;
  assert.deepEqual(conceptA.contributing.map((s) => s.sessionNumber), [2, 1]); // 9 votes, then 7
});

test("buildMomentGroups never fabricates a contributing session for an unlinked idea", () => {
  const { rooms, clusters } = joinFixture();
  const groups = buildMomentGroups(rooms, clusters);
  const conceptB = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-B")!;
  assert.deepEqual(conceptB.contributing, []);
});

test("buildMomentGroups' topVotedLinkedIdeas counts only this concept's ideas that ranked top-third by votes within their own session", () => {
  const { rooms, clusters } = joinFixture();
  const groups = buildMomentGroups(rooms, clusters);
  const conceptA = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-A")!;
  // Session 1 has two ideas total, both C-A's (I-1 votes=5, I-2 votes=2) —
  // top third of 2 is ceil(2/3)=1, so only the higher-voted one qualifies.
  const session1 = conceptA.contributing.find((s) => s.sessionNumber === 1)!;
  assert.equal(session1.topVotedLinkedIdeas, 1);
  // Session 2 has exactly one idea (I-3, C-A's) — trivially top-third.
  const session2 = conceptA.contributing.find((s) => s.sessionNumber === 2)!;
  assert.equal(session2.topVotedLinkedIdeas, 1);
});

test("buildMomentGroups' topVotedLinkedIdeas is computed against the whole session, not just this concept's own ideas", () => {
  // A 6-idea session where C-Y holds the 3rd-highest-voted idea: top third of
  // 6 is ceil(6/3)=2, so a rank-3 idea must NOT count as top-voted, even
  // though it would look "first" if only C-Y's own (single) idea were ranked
  // in isolation.
  const concepts: RoomsConcept[] = [{ id: "C-Y", subthemeId: "ST-A", themeId: "T1", name: "Concept Y", sessions: 1, votes: 5, ideas: 1, topIdeas: 0 }];
  const ideas: RoomsData["ideas"] = [
    { id: "I-1", sessionNumber: 1, votes: 10, voteRatio: 1, conceptId: null },
    { id: "I-2", sessionNumber: 1, votes: 9, voteRatio: 1, conceptId: null },
    { id: "I-3", sessionNumber: 1, votes: 5, voteRatio: 1, conceptId: "C-Y" }, // rank 3 of 6 — outside top third
    { id: "I-4", sessionNumber: 1, votes: 4, voteRatio: 1, conceptId: null },
    { id: "I-5", sessionNumber: 1, votes: 3, voteRatio: 1, conceptId: null },
    { id: "I-6", sessionNumber: 1, votes: 2, voteRatio: 1, conceptId: null },
  ];
  const sessions: RoomsData["sessions"] = [
    { id: "S1", number: 1, date: "2026-07-01", attendees: 1, facilitators: 1, ideas: 6, votes: 33, votesPerAttendee: 33 },
  ];
  const clusters: Cluster[] = [{ n: 1, rings: [], rc: 30, ang: 0, x: 0, y: 0, date: "2026-07-01", pulsePhase: 0, pulsePeriod: 1 }];
  const groups = buildMomentGroups(roomsFixture(concepts, ideas, sessions), clusters);
  const conceptY = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-Y")!;
  const session1 = conceptY.contributing.find((s) => s.sessionNumber === 1)!;
  assert.equal(session1.linkedIdeas, 1);
  assert.equal(session1.topVotedLinkedIdeas, 0);
});

test("buildMomentGroups' derivedSessions can legitimately differ from the concept's own statedSessions in either direction", () => {
  // A concept whose linked-idea session count comes in *higher* than its own
  // stated `sessions` field is a real, documented anomaly in the production
  // data (concept C-17 in rooms.json) — this must surface honestly, not get
  // clamped to agree with statedSessions.
  const concepts: RoomsConcept[] = [{ id: "C-X", subthemeId: "ST-A", themeId: "T1", name: "Concept X", sessions: 1, votes: 5, ideas: 2, topIdeas: 0 }];
  const ideas: RoomsData["ideas"] = [
    { id: "I-1", sessionNumber: 1, votes: 1, voteRatio: 1, conceptId: "C-X" },
    { id: "I-2", sessionNumber: 2, votes: 1, voteRatio: 1, conceptId: "C-X" },
  ];
  const sessions: RoomsData["sessions"] = [
    { id: "S1", number: 1, date: "2026-07-01", attendees: 1, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 },
    { id: "S2", number: 2, date: "2026-07-02", attendees: 1, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 },
  ];
  const clusters: Cluster[] = [
    { n: 1, rings: [], rc: 30, ang: 0, x: 0, y: 0, date: "2026-07-01", pulsePhase: 0, pulsePeriod: 1 },
    { n: 1, rings: [], rc: 30, ang: 1, x: 0, y: 0, date: "2026-07-02", pulsePhase: 0, pulsePeriod: 1 },
  ];
  const groups = buildMomentGroups(roomsFixture(concepts, ideas, sessions), clusters);
  const conceptX = groups.flatMap((g) => g.concepts).find((c) => c.id === "C-X")!;
  assert.equal(conceptX.statedSessions, 1);
  assert.equal(conceptX.derivedSessions, 2);
});

test("attributionFor: a substantive field of work + a named region", () => {
  assert.equal(attributionFor([{ region: "Bay Area", fieldOfWork: "Financial" }], 0), "Finance worker in the Bay Area");
});

test("attributionFor: is deterministic for the same seed and attendee list", () => {
  const attendees = [
    { region: "Los Angeles", fieldOfWork: "Government" },
    { region: "Bay Area", fieldOfWork: "Healthcare" },
  ];
  assert.equal(attributionFor(attendees, 3), attributionFor(attendees, 3));
});

test("attributionFor: picks different attendees for different seeds when more than one is available", () => {
  const attendees = [
    { region: "Los Angeles", fieldOfWork: "Government" },
    { region: "Bay Area", fieldOfWork: "Healthcare" },
  ];
  assert.notEqual(attributionFor(attendees, 0), attributionFor(attendees, 1));
});

test("attributionFor: omits the region clause for a not-stated region rather than guessing", () => {
  const line = attributionFor([{ region: "(not stated)", fieldOfWork: "Government" }], 0);
  assert.equal(line, "Government worker");
  assert.ok(!line.includes("not stated"));
});

test("attributionFor: never claims a 'worker' phrase for someone not currently working", () => {
  const line = attributionFor([{ region: "Bay Area", fieldOfWork: "I don't currently work" }], 0);
  assert.equal(line, "Attendee in the Bay Area");
});

test("attributionFor: falls back gracefully with no attendees at all", () => {
  assert.equal(attributionFor([], 0), "An attendee");
});

test("placeholderQuoteFor: deterministic and always one of the declared placeholders", () => {
  assert.equal(placeholderQuoteFor(1), placeholderQuoteFor(1));
  assert.ok(PLACEHOLDER_QUOTES.includes(placeholderQuoteFor(5)));
});

// --- displayNameFor / cardQuotesFor — invented fixture text throughout;
// README data rule 2 forbids real response text in a tracked file, so this
// never touches the actual insights.json content.

function momentConceptFixture(overrides: Partial<MomentConcept> = {}): MomentConcept {
  return {
    id: "C-99",
    name: "Fixture concept name",
    themeId: "T1",
    composite: 5,
    order: 0.5,
    statedSessions: 4,
    derivedSessions: 4,
    votes: 12,
    ideas: 3,
    topIdeas: 1,
    contributing: [],
    ...overrides,
  };
}

function sessionFixture(overrides: Partial<MomentSession> = {}): MomentSession {
  return { clusterIndex: 0, sessionNumber: 1, date: "2026-07-01", linkedIdeas: 1, votes: 5, topVotedLinkedIdeas: 0, ...overrides };
}

test("displayNameFor: falls back to the rooms.json concept name with no insight", () => {
  const concept = momentConceptFixture();
  assert.equal(displayNameFor(concept), "Fixture concept name");
  assert.equal(displayNameFor(concept, { quotes: [] }), "Fixture concept name");
});

test("displayNameFor: prefers the insight's plain-language name when present", () => {
  const concept = momentConceptFixture();
  const insight: ConceptInsight = { name: "Fixture plain-language name", quotes: [] };
  assert.equal(displayNameFor(concept, insight), "Fixture plain-language name");
});

test("cardQuotesFor: with insight quotes, returns them verbatim with isPlaceholder false and ignores contributing sessions", () => {
  const concept = momentConceptFixture({ contributing: [sessionFixture()] });
  const insight: ConceptInsight = {
    quotes: [
      { text: "Invented fixture quote one.", byline: "fixture worker in Fixture Region" },
      { text: "Invented fixture quote two.", byline: "another fixture attendee" },
    ],
  };
  const result = cardQuotesFor(concept, insight, () => [], 0);
  assert.deepEqual(result, [
    { text: "Invented fixture quote one.", byline: "fixture worker in Fixture Region", isPlaceholder: false },
    { text: "Invented fixture quote two.", byline: "another fixture attendee", isPlaceholder: false },
  ]);
});

test("cardQuotesFor: falls back to placeholder quotes + attendee bylines when no insight is given", () => {
  const attendee = { region: "Bay Area", fieldOfWork: "Financial" };
  const concept = momentConceptFixture({ contributing: [sessionFixture()] });
  const result = cardQuotesFor(concept, undefined, () => [attendee], 0);
  assert.equal(result.length, 1);
  assert.equal(result[0].isPlaceholder, true);
  assert.ok(PLACEHOLDER_QUOTES.includes(result[0].text));
  assert.equal(result[0].byline, "Finance worker in the Bay Area");
});

test("cardQuotesFor: falls back to placeholder path when the insight has no quotes", () => {
  const concept = momentConceptFixture({ contributing: [sessionFixture()] });
  const result = cardQuotesFor(concept, { quotes: [] }, () => [], 0);
  assert.equal(result.length, 1);
  assert.equal(result[0].isPlaceholder, true);
});

test("cardQuotesFor: caps the placeholder path at two contributing sessions", () => {
  const concept = momentConceptFixture({
    contributing: [sessionFixture({ sessionNumber: 1 }), sessionFixture({ sessionNumber: 2 }), sessionFixture({ sessionNumber: 3 })],
  });
  const result = cardQuotesFor(concept, undefined, () => [], 0);
  assert.equal(result.length, 2);
});

test("cardQuotesFor: placeholder path is deterministic for the same seed", () => {
  const concept = momentConceptFixture({ contributing: [sessionFixture()] });
  const a = cardQuotesFor(concept, undefined, () => [], 7);
  const b = cardQuotesFor(concept, undefined, () => [], 7);
  assert.deepEqual(a, b);
});
