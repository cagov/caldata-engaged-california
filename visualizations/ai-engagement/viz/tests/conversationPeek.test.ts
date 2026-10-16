import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversationPeeks, sessionDateLabel } from "../src/lib/conversationPeek.ts";
import type { MomentAttendee } from "../src/lib/deliberativeMoments.ts";
import type { RoomsData } from "../src/lib/roomsData.ts";
import type { Cluster } from "../src/lib/funnelCloud.ts";
import type { InsightsData } from "../src/lib/insightsData.ts";

function roomsFixture(sessions: RoomsData["sessions"], concepts: RoomsData["concepts"] = []): RoomsData {
  return {
    meta: {
      generated: "",
      sourceFile: "",
      sourceHash: "",
      sessions: sessions.length,
      attendees: 0,
      ideas: 0,
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
    ideas: [],
  };
}

function insightsFixture(overrides: Partial<InsightsData> = {}): InsightsData {
  return { meta: { source: "", note: "" }, concepts: {}, ...overrides };
}

function cluster(overrides: Partial<Cluster> = {}): Cluster {
  return { n: 3, rings: [], rc: 30, ang: 0, x: 0, y: 0, date: "2026-07-17", pulsePhase: 0, pulsePeriod: 1, ...overrides };
}

const THREE_ATTENDEES: MomentAttendee[] = [
  { region: "Bay Area", fieldOfWork: "Financial" },
  { region: "Los Angeles", fieldOfWork: "Retail" },
  { region: "Sierra Region", fieldOfWork: "Education" },
];

test("sessionDateLabel formats YYYY-MM-DD as a month name and day", () => {
  assert.equal(sessionDateLabel("2026-07-17"), "July 17");
  assert.equal(sessionDateLabel("2026-01-01"), "January 1");
});

test("sessionDateLabel never drifts a day regardless of the runtime's own timezone", () => {
  // Hand-parsing (not `new Date(iso)`) is the whole point — a UTC parse
  // formatted back out in a negative-UTC-offset zone like
  // America/Los_Angeles would render "July 16" for a "2026-07-17" input.
  assert.equal(sessionDateLabel("2026-07-17"), "July 17");
  assert.equal(sessionDateLabel("2026-12-31"), "December 31");
});

test("buildConversationPeeks joins session number by date, not by array/cluster position", () => {
  const clusters = [
    cluster({ date: "2026-07-02" }), // deliberately out of session-number order
    cluster({ date: "2026-07-01" }),
  ];
  const rooms = roomsFixture([
    { id: "S1", number: 1, date: "2026-07-01", attendees: 3, facilitators: 1, ideas: 2, votes: 7, votesPerAttendee: 1.4 },
    { id: "S2", number: 2, date: "2026-07-02", attendees: 3, facilitators: 1, ideas: 1, votes: 9, votesPerAttendee: 2.25 },
  ]);
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  assert.equal(peeks[0].sessionNumber, 2); // clusters[0] is the 07-02 cluster
  assert.equal(peeks[1].sessionNumber, 1); // clusters[1] is the 07-01 cluster
});

test("buildConversationPeeks yields sessionNumber: null, and still renders, when no rooms session shares the cluster's date", () => {
  const clusters = [cluster({ date: "2026-08-30" })];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-01", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  assert.equal(peeks.length, 1);
  assert.equal(peeks[0].sessionNumber, null);
  assert.equal(peeks[0].turns.length, 3);
});

test("buildConversationPeeks produces exactly 3 turns per conversation", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  assert.equal(peeks[0].turns.length, 3);
  peeks[0].turns.forEach((turn) => assert.equal(turn.isPlaceholder, true));
});

test("buildConversationPeeks attributes every turn's speaker to a real member of that session's attendee list", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  for (const turn of peeks[0].turns) {
    assert.ok(THREE_ATTENDEES.some((a) => a.region === turn.region && a.fieldOfWork === turn.fieldOfWork));
  }
});

test("buildConversationPeeks picks 3 distinct speakers when the session has at least 3 real attendees", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  const pairs = peeks[0].turns.map((t) => `${t.region}|${t.fieldOfWork}`);
  assert.equal(new Set(pairs).size, 3);
});

test("buildConversationPeeks is deterministic across calls with the same inputs", () => {
  const clusters = [cluster({ date: "2026-07-17" }), cluster({ date: "2026-07-20" })];
  const rooms = roomsFixture([
    { id: "S1", number: 1, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 },
    { id: "S2", number: 2, date: "2026-07-20", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 },
  ]);
  const a = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  const b = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES);
  assert.deepEqual(a, b);
});

test("buildConversationPeeks falls back to an empty region/fieldOfWork when a session has no real attendees", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-17", attendees: 0, facilitators: 1, ideas: 0, votes: 0, votesPerAttendee: 0 }]);
  const peeks = buildConversationPeeks(clusters, rooms, () => []);
  assert.equal(peeks[0].attendeeCount, 0);
  peeks[0].turns.forEach((turn) => {
    assert.equal(turn.region, "");
    assert.equal(turn.fieldOfWork, "");
  });
});

test("a session named in insights.sessions replaces its placeholder exchange entirely with the real turns given", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S8", number: 8, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const insights = insightsFixture({
    sessions: {
      "8": { turns: [{ text: "Real quote text.", byline: "Creative worker in Los Angeles", region: "Los Angeles", fieldOfWork: "Creative" }] },
    },
  });
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insights);
  assert.equal(peeks[0].turns.length, 1);
  assert.equal(peeks[0].turns[0].text, "Real quote text.");
  assert.equal(peeks[0].turns[0].byline, "Creative worker in Los Angeles");
  assert.equal(peeks[0].turns[0].region, "Los Angeles");
  assert.equal(peeks[0].turns[0].fieldOfWork, "Creative");
  assert.equal(peeks[0].turns[0].isPlaceholder, false);
});

test("an override turn with no byline of its own attributes to a real attendee instead, same as a placeholder turn", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S8", number: 8, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const insights = insightsFixture({ sessions: { "8": { turns: [{ text: "Real quote, unattributed." }] } } });
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insights);
  assert.equal(peeks[0].turns[0].isPlaceholder, false);
  assert.ok(THREE_ATTENDEES.some((a) => a.region === peeks[0].turns[0].region && a.fieldOfWork === peeks[0].turns[0].fieldOfWork));
});

test("a session absent from insights.sessions (or a null insights) keeps its 3-turn placeholder exchange", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S1", number: 1, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const withInsights = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insightsFixture());
  const withoutInsights = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, null);
  for (const peeks of [withInsights, withoutInsights]) {
    assert.equal(peeks[0].turns.length, 3);
    peeks[0].turns.forEach((turn) => assert.equal(turn.isPlaceholder, true));
    assert.equal(peeks[0].linkedConceptName, null);
  }
});

test("linkedConceptName prefers insights.json's own plain-language rewrite over rooms.json's raw concept name", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture(
    [{ id: "S8", number: 8, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }],
    [{ id: "C-25", subthemeId: "ST-07", themeId: "T2", name: "Hold AI companies accountable for protecting consumers", sessions: 7, votes: 37, ideas: 11, topIdeas: 4 }],
  );
  const insights = insightsFixture({
    concepts: { "C-25": { name: "Hold the companies that build and deploy AI liable for the harms their products cause", quotes: [] } },
    sessions: { "8": { turns: [{ text: "Real quote." }], linkedConceptId: "C-25" } },
  });
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insights);
  assert.equal(peeks[0].linkedConceptName, "Hold the companies that build and deploy AI liable for the harms their products cause");
});

test("linkedConceptName falls back to rooms.json's own concept name when insights.json's concepts map has no rewrite for it", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture(
    [{ id: "S8", number: 8, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }],
    [{ id: "C-25", subthemeId: "ST-07", themeId: "T2", name: "Hold AI companies accountable for protecting consumers", sessions: 7, votes: 37, ideas: 11, topIdeas: 4 }],
  );
  const insights = insightsFixture({ sessions: { "8": { turns: [{ text: "Real quote." }], linkedConceptId: "C-25" } } });
  const peeks = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insights);
  assert.equal(peeks[0].linkedConceptName, "Hold AI companies accountable for protecting consumers");
});

test("linkedConceptName is null when the session override names no linkedConceptId, or names one rooms.json doesn't have", () => {
  const clusters = [cluster()];
  const rooms = roomsFixture([{ id: "S8", number: 8, date: "2026-07-17", attendees: 3, facilitators: 1, ideas: 1, votes: 1, votesPerAttendee: 1 }]);
  const noLink = buildConversationPeeks(clusters, rooms, () => THREE_ATTENDEES, insightsFixture({ sessions: { "8": { turns: [{ text: "x" }] } } }));
  assert.equal(noLink[0].linkedConceptName, null);
  const badLink = buildConversationPeeks(
    clusters,
    rooms,
    () => THREE_ATTENDEES,
    insightsFixture({ sessions: { "8": { turns: [{ text: "x" }], linkedConceptId: "C-999" } } }),
  );
  assert.equal(badLink[0].linkedConceptName, null);
});
