import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIdeaConceptSystem,
  buildIdeaConceptUser,
  validateIdeaConceptResponse,
  reconcileIdeaConceptMapping,
  IDEA_CONCEPT_SCHEMA,
  type IdeaConceptTarget,
  type ProposedIdea,
} from "../src/lib/ideaLinkage.ts";
import type { RoomsData } from "../src/lib/roomsData.ts";

const FIXTURE_CONCEPTS: IdeaConceptTarget[] = [
  { id: "C-01", name: "Incentivize keeping jobs", subthemeId: "ST-01", themeId: "T1" },
  { id: "C-02", name: "Shift or reskill employees", subthemeId: "ST-01", themeId: "T1" },
  { id: "C-03", name: "Require impact disclosure", subthemeId: "ST-06", themeId: "T2" },
];

test("buildIdeaConceptSystem includes every concept id and name, grouped by theme/subtheme id", () => {
  const system = buildIdeaConceptSystem(FIXTURE_CONCEPTS);
  assert.ok(system.includes("C-01"));
  assert.ok(system.includes("Incentivize keeping jobs"));
  assert.ok(system.includes("C-02"));
  assert.ok(system.includes("Shift or reskill employees"));
  assert.ok(system.includes("C-03"));
  assert.ok(system.includes("Require impact disclosure"));
  assert.ok(system.includes("T1"));
  assert.ok(system.includes("T2"));
  assert.ok(system.includes("ST-01"));
  assert.ok(system.includes("ST-06"));
});

test("buildIdeaConceptSystem states the single-label and no-invented-id rules", () => {
  const system = buildIdeaConceptSystem(FIXTURE_CONCEPTS).toLowerCase();
  assert.ok(system.includes("single-label"));
  assert.ok(system.includes("exactly one concept id"));
  assert.ok(system.includes("null"));
  assert.ok(system.includes("only use concept ids from"));
});

test("buildIdeaConceptUser renders the idea text", () => {
  const user = buildIdeaConceptUser("Give tax breaks to companies that keep workers.");
  assert.ok(user.includes("Give tax breaks to companies that keep workers."));
});

test("IDEA_CONCEPT_SCHEMA describes the {conceptId} response shape", () => {
  assert.equal(IDEA_CONCEPT_SCHEMA.type, "object");
  assert.ok("conceptId" in IDEA_CONCEPT_SCHEMA.properties);
  assert.deepEqual(IDEA_CONCEPT_SCHEMA.required, ["conceptId"]);
});

test("validateIdeaConceptResponse accepts a valid concept id", () => {
  const validIds = new Set(FIXTURE_CONCEPTS.map((c) => c.id));
  const result = validateIdeaConceptResponse({ conceptId: "C-02" }, validIds);
  assert.deepEqual(result, { conceptId: "C-02" });
});

test("validateIdeaConceptResponse accepts a null conceptId (no clear match)", () => {
  const validIds = new Set(FIXTURE_CONCEPTS.map((c) => c.id));
  const result = validateIdeaConceptResponse({ conceptId: null }, validIds);
  assert.deepEqual(result, { conceptId: null });
});

test("validateIdeaConceptResponse filters (does not throw on) an unrecognized concept id", () => {
  const validIds = new Set(FIXTURE_CONCEPTS.map((c) => c.id));
  const result = validateIdeaConceptResponse({ conceptId: "C-99" }, validIds);
  assert.deepEqual(result, { conceptId: null, unknownId: "C-99" });
});

test("validateIdeaConceptResponse throws on a structurally invalid payload", () => {
  const validIds = new Set(FIXTURE_CONCEPTS.map((c) => c.id));
  assert.throws(() => validateIdeaConceptResponse({ notConceptId: "C-01" }, validIds));
  assert.throws(() => validateIdeaConceptResponse({ conceptId: 42 }, validIds));
});

// --- reconcileIdeaConceptMapping ---------------------------------------------

const FIXTURE_ROOMS_CONCEPTS: RoomsData["concepts"] = [
  { id: "C-01", subthemeId: "ST-01", themeId: "T1", name: "Incentivize keeping jobs", sessions: 2, votes: 10, ideas: 2, topIdeas: 1 },
  { id: "C-02", subthemeId: "ST-01", themeId: "T1", name: "Shift or reskill employees", sessions: 1, votes: 3, ideas: 1, topIdeas: 0 },
  { id: "C-03", subthemeId: "ST-06", themeId: "T2", name: "Require impact disclosure", sessions: 3, votes: 20, ideas: 4, topIdeas: 2 },
];

test("reconcileIdeaConceptMapping returns one row per concept, including full agreement", () => {
  // Proposed mapping that exactly matches C-01's stated counts (2 ideas,
  // sessions 1 and 3, votes 4+6=10), leaves C-02 and C-03 with no assigned
  // ideas at all.
  const ideas: ProposedIdea[] = [
    { id: "I-001", sessionNumber: 1, votes: 4, conceptId: "C-01" },
    { id: "I-002", sessionNumber: 3, votes: 6, conceptId: "C-01" },
  ];
  const rows = reconcileIdeaConceptMapping(FIXTURE_ROOMS_CONCEPTS, ideas);

  assert.equal(rows.length, 3);

  const c01 = rows.find((r) => r.conceptId === "C-01")!;
  assert.deepEqual(c01, {
    conceptId: "C-01",
    name: "Incentivize keeping jobs",
    statedIdeas: 2,
    computedIdeas: 2,
    statedVotes: 10,
    computedVotes: 10,
    statedSessions: 2,
    computedSessions: 2,
  });

  const c02 = rows.find((r) => r.conceptId === "C-02")!;
  assert.equal(c02.computedIdeas, 0);
  assert.equal(c02.computedVotes, 0);
  assert.equal(c02.computedSessions, 0);
  assert.equal(c02.statedIdeas, 1);

  const c03 = rows.find((r) => r.conceptId === "C-03")!;
  assert.equal(c03.computedIdeas, 0);
  assert.equal(c03.statedIdeas, 4);
});

test("reconcileIdeaConceptMapping surfaces a real mismatch rather than silently passing", () => {
  // C-02 is stated as 1 idea / 3 votes / 1 session, but the proposed mapping
  // assigns it two ideas from two different sessions with 5 votes total —
  // every one of the three recomputed numbers should disagree with stated.
  const ideas: ProposedIdea[] = [
    { id: "I-010", sessionNumber: 4, votes: 2, conceptId: "C-02" },
    { id: "I-011", sessionNumber: 5, votes: 3, conceptId: "C-02" },
  ];
  const rows = reconcileIdeaConceptMapping(FIXTURE_ROOMS_CONCEPTS, ideas);
  const c02 = rows.find((r) => r.conceptId === "C-02")!;

  assert.notEqual(c02.statedIdeas, c02.computedIdeas);
  assert.notEqual(c02.statedVotes, c02.computedVotes);
  assert.notEqual(c02.statedSessions, c02.computedSessions);
  assert.equal(c02.computedIdeas, 2);
  assert.equal(c02.computedVotes, 5);
  assert.equal(c02.computedSessions, 2);
});

test("reconcileIdeaConceptMapping ignores ideas with a null conceptId", () => {
  const ideas: ProposedIdea[] = [
    { id: "I-020", sessionNumber: 1, votes: 100, conceptId: null },
  ];
  const rows = reconcileIdeaConceptMapping(FIXTURE_ROOMS_CONCEPTS, ideas);
  for (const row of rows) {
    assert.equal(row.computedIdeas, 0);
    assert.equal(row.computedVotes, 0);
  }
});
