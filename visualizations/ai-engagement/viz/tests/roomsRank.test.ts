import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankValue,
  sessionsOf,
  themeIdOf,
  votesPerIdea,
  sortByRank,
  sortIdeasByVotes,
  entryLevelOf,
  ideaMatchesEntry,
  compositeMetric,
  popularityBinOf,
  type RankableEntry,
} from "../src/lib/roomsRank.ts";
import type { RoomsTheme, RoomsSubtheme, RoomsConcept, RoomsIdea } from "../src/lib/roomsData.ts";

const theme: RoomsTheme = { id: "T1", name: "Theme one", votes: 10, ideas: 4, topIdeas: 2, subthemes: 1 };
const subtheme: RoomsSubtheme = {
  id: "ST-01",
  themeId: "T1",
  name: "Subtheme one",
  statedVotes: 9,
  statedIdeas: 3,
  statedSessions: 5,
  votes: 10,
  ideas: 4,
  topIdeas: 2,
  concepts: 1,
};
const subthemeNullSessions: RoomsSubtheme = { ...subtheme, id: "ST-02", statedSessions: null };
const concept: RoomsConcept = { id: "C-01", subthemeId: "ST-01", themeId: "T1", name: "Concept one", sessions: 3, votes: 10, ideas: 4, topIdeas: 2 };

test("sessionsOf: concepts report their own computed session count", () => {
  assert.equal(sessionsOf(concept), 3);
});

test("sessionsOf: subthemes report the stated (parenthetical) session count", () => {
  assert.equal(sessionsOf(subtheme), 5);
  assert.equal(sessionsOf(subthemeNullSessions), null);
});

test("sessionsOf: themes have no session count at all — null, not a fabricated sum", () => {
  assert.equal(sessionsOf(theme), null);
});

test("themeIdOf: subthemes and concepts report their own themeId", () => {
  assert.equal(themeIdOf(subtheme), "T1");
  assert.equal(themeIdOf(concept), "T1");
});

test("themeIdOf: a theme entry has no themeId of its own — reports its own id", () => {
  assert.equal(themeIdOf(theme), "T1");
});

test("votesPerIdea divides votes by ideas, guarding divide-by-zero", () => {
  assert.equal(votesPerIdea({ ...theme, votes: 12, ideas: 4 }), 3);
  assert.equal(votesPerIdea({ ...theme, votes: 12, ideas: 0 }), 0);
});

test("rankValue dispatches to the right field per metric", () => {
  assert.equal(rankValue(concept, "votes"), 10);
  assert.equal(rankValue(concept, "ideas"), 4);
  assert.equal(rankValue(concept, "topIdeas"), 2);
  assert.equal(rankValue(concept, "sessions"), 3);
  assert.equal(rankValue(concept, "votesPerIdea"), 2.5);
});

// A second concept under a different subtheme/theme, for match-vs-no-match cases.
const otherTheme: RoomsTheme = { id: "T2", name: "Theme two", votes: 5, ideas: 2, topIdeas: 1, subthemes: 1 };
const otherSubtheme: RoomsSubtheme = {
  id: "ST-02",
  themeId: "T2",
  name: "Subtheme two",
  statedVotes: null,
  statedIdeas: null,
  statedSessions: null,
  votes: 5,
  ideas: 2,
  topIdeas: 1,
  concepts: 1,
};
const otherConcept: RoomsConcept = { id: "C-02", subthemeId: "ST-02", themeId: "T2", name: "Concept two", sessions: 2, votes: 5, ideas: 2, topIdeas: 1 };

test("entryLevelOf identifies each entry shape by its own discriminant fields", () => {
  assert.equal(entryLevelOf(theme), "theme");
  assert.equal(entryLevelOf(subtheme), "subtheme");
  assert.equal(entryLevelOf(concept), "concept");
});

test("ideaMatchesEntry: a concept-level entry matches only the same concept", () => {
  assert.equal(ideaMatchesEntry(concept, concept), true);
  assert.equal(ideaMatchesEntry(otherConcept, concept), false);
});

test("ideaMatchesEntry: a subtheme-level entry matches any concept under it", () => {
  assert.equal(ideaMatchesEntry(concept, subtheme), true);
  assert.equal(ideaMatchesEntry(otherConcept, subtheme), false);
});

test("ideaMatchesEntry: a theme-level entry matches any concept under any of its subthemes", () => {
  assert.equal(ideaMatchesEntry(concept, theme), true);
  assert.equal(ideaMatchesEntry(otherConcept, theme), false);
  assert.equal(ideaMatchesEntry(otherConcept, otherTheme), true);
});

test("ideaMatchesEntry: an idea with no resolvable concept (unlinked) never matches", () => {
  assert.equal(ideaMatchesEntry(undefined, concept), false);
  assert.equal(ideaMatchesEntry(undefined, subtheme), false);
  assert.equal(ideaMatchesEntry(undefined, theme), false);
});

test("compositeMetric adds sessions and topIdeas for a subtheme/concept", () => {
  assert.equal(compositeMetric(concept), 3 + 2); // concept.sessions=3, topIdeas=2
  assert.equal(compositeMetric(subtheme), 5 + 2); // subtheme.statedSessions=5, topIdeas=2
});

test("compositeMetric is null for a theme, since sessionsOf(theme) is always null", () => {
  assert.equal(compositeMetric(theme), null);
});

test("compositeMetric is null when sessionsOf is null (a subtheme with no stated session count)", () => {
  assert.equal(compositeMetric(subthemeNullSessions), null);
});

test("popularityBinOf sorts real composite values into the exact given ranges", () => {
  assert.equal(popularityBinOf(11), "most popular");
  assert.equal(popularityBinOf(9), "most popular");
  assert.equal(popularityBinOf(7), "popular");
  assert.equal(popularityBinOf(6), "popular");
  assert.equal(popularityBinOf(4), "less popular");
  assert.equal(popularityBinOf(3), "less popular");
  assert.equal(popularityBinOf(2), "least popular");
  assert.equal(popularityBinOf(1), "least popular");
});

test("popularityBinOf reports null for values in a real gap between bins (5, 8) or outside all bins (0)", () => {
  assert.equal(popularityBinOf(5), null);
  assert.equal(popularityBinOf(8), null);
  assert.equal(popularityBinOf(0), null);
});

test("popularityBinOf reports null when composite itself is null", () => {
  assert.equal(popularityBinOf(null), null);
});

test("sortByRank sorts descending by the chosen metric", () => {
  const a: RoomsConcept = { ...concept, id: "A", votes: 5 };
  const b: RoomsConcept = { ...concept, id: "B", votes: 20 };
  const c: RoomsConcept = { ...concept, id: "C", votes: 10 };
  const sorted = sortByRank([a, b, c], "votes");
  assert.deepEqual(sorted.map((e) => e.id), ["B", "C", "A"]);
});

test("sortByRank keeps ties in original (stable) order", () => {
  const a: RoomsConcept = { ...concept, id: "A", votes: 10 };
  const b: RoomsConcept = { ...concept, id: "B", votes: 10 };
  const sorted = sortByRank([a, b], "votes");
  assert.deepEqual(sorted.map((e) => e.id), ["A", "B"]);
});

test("sortByRank pushes entries with a null metric value (themes under 'sessions') to the end", () => {
  const t1: RoomsTheme = { ...theme, id: "T1" };
  const t2: RoomsTheme = { ...theme, id: "T2" };
  const entries: RankableEntry[] = [t1, t2];
  const sorted = sortByRank(entries, "sessions");
  // Both are null — order is preserved (stable), and no crash/NaN sort.
  assert.deepEqual(sorted.map((e) => e.id), ["T1", "T2"]);
});

test("sortByRank: a real value always outranks a null value regardless of input order", () => {
  const withNull: RoomsSubtheme = { ...subthemeNullSessions, id: "NULL" };
  const withValue: RoomsSubtheme = { ...subtheme, id: "VALUE", statedSessions: 1 };
  const sorted = sortByRank([withNull, withValue], "sessions");
  assert.deepEqual(sorted.map((e) => e.id), ["VALUE", "NULL"]);
});

test("sortIdeasByVotes sorts descending by votes, stable on ties", () => {
  const ideas: RoomsIdea[] = [
    { id: "I-1", sessionNumber: 1, votes: 2, voteRatio: 0.5, conceptId: null },
    { id: "I-2", sessionNumber: 1, votes: 6, voteRatio: 1, conceptId: null },
    { id: "I-3", sessionNumber: 1, votes: 6, voteRatio: 1, conceptId: null },
    { id: "I-4", sessionNumber: 1, votes: 0, voteRatio: 0, conceptId: null },
  ];
  const sorted = sortIdeasByVotes(ideas);
  assert.deepEqual(sorted.map((i) => i.id), ["I-2", "I-3", "I-1", "I-4"]);
});
