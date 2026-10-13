import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayers, type DistillGraph } from "../src/lib/distill.ts";
import type { CrosswalkData } from "../src/lib/crosswalkData.ts";
import type { RoomsData } from "../src/lib/roomsData.ts";

function fixtureCrosswalk(): CrosswalkData {
  return {
    meta: {
      generated: "now", version: "v1", codebookVersion: "cb1", roomsSourceHash: "h1",
      status: "approved", approvedBy: "tester", method: "m", caveat: "interpretive",
    },
    themes: [
      { code: "REGULATE", label: "Regulate", home: "government", counts: { personal: 0, economy: 0, government: 1000 } },
      { code: "JOB_LOSS", label: "Job losses", home: "economy", counts: { personal: 0, economy: 500, government: 0 } },
      { code: "NO_IMPACT", label: "No impact", home: "personal", counts: { personal: 400, economy: 0, government: 0 } },
    ],
    edges: [
      { conceptId: "C-01", code: "REGULATE", field: "government", strength: "primary", rationale: "r" },
      { conceptId: "C-01", code: "JOB_LOSS", field: "economy", strength: "secondary", rationale: "r" },
      { conceptId: "C-02", code: "JOB_LOSS", field: "economy", strength: "primary", rationale: "r" },
    ],
    unclaimedCodes: ["NO_IMPACT"],
    concepts: [
      { conceptId: "C-01", sessionsPct: 50, topPct: 44, voteToIdeaRatio: 3.4, compositePctSum: 94, compositeCountSum: 11 },
      { conceptId: "C-02", sessionsPct: 20, topPct: 10, voteToIdeaRatio: 1.2, compositePctSum: 30, compositeCountSum: 5 },
    ],
  };
}

function fixtureRooms(): RoomsData {
  return {
    meta: {
      generated: "now", sourceFile: "f", sourceHash: "h", sessions: 1, attendees: 1, ideas: 1, votes: 1,
      sampleCaveat: "c", reconciliation: [], hasIdeaLinkage: false, linkageCoverage: 0,
    },
    themes: [{ id: "T1", name: "Theme One", votes: 10, ideas: 2, topIdeas: 1, subthemes: 1 }],
    subthemes: [{ id: "ST-01", themeId: "T1", name: "Subtheme One", statedVotes: null, statedIdeas: null, statedSessions: null, votes: 10, ideas: 2, topIdeas: 1, concepts: 2 }],
    concepts: [
      { id: "C-01", subthemeId: "ST-01", themeId: "T1", name: "Concept One", sessions: 5, votes: 8, ideas: 3, topIdeas: 1 },
      { id: "C-02", subthemeId: "ST-01", themeId: "T1", name: "Concept Two", sessions: 2, votes: 2, ideas: 1, topIdeas: 0 },
    ],
    sessions: [],
    ideas: [],
  };
}

test("buildLayers includes only themes matching the requested scope", () => {
  // themeNodes holds CLAIMED themes only (unclaimed ones live in
  // graph.unclaimed instead — see the "reports unclaimed themes separately"
  // test below), so scope "all" still yields 2 here, not 3: NO_IMPACT is
  // in scope (home "personal" is included under "all") but has no edge in
  // the fixture, so it's unclaimed regardless of scope.
  const all = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  assert.equal(all.themeNodes.length, 2);

  const policy = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "policy", minStrength: "tangential" });
  assert.deepEqual(policy.themeNodes.map((t) => t.id).sort(), ["JOB_LOSS", "REGULATE"]);
});

test("buildLayers filters edges below the minStrength floor", () => {
  const primaryOnly = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "primary" });
  assert.equal(primaryOnly.edges.length, 2); // REGULATE->C-01 (primary), JOB_LOSS->C-02 (primary); JOB_LOSS->C-01 is secondary, dropped
});

test("buildLayers normalizes each level's node weights to sum to 1", () => {
  const graph = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  for (const level of graph.levels) {
    const sum = level.nodeIds.reduce((acc, id) => acc + (graph.nodesById.get(id)?.weight ?? 0), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `level ${level.id} weights sum to ${sum}, want 1`);
  }
});

test("buildLayers tapers each edge: wSource is a share of the theme, wTarget a share of the concept", () => {
  const graph = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  // JOB_LOSS (500) feeds C-01 (secondary, weight 2*500=1000) and C-02 (primary, weight 3*500=1500).
  const fromJobLoss = graph.edges.filter((e) => e.code === "JOB_LOSS");
  const sourceShareSum = fromJobLoss.reduce((acc, e) => acc + e.wSource, 0);
  assert.ok(Math.abs(sourceShareSum - 1) < 1e-9, "a theme's outgoing edges split its full share");

  const intoC01 = graph.edges.filter((e) => e.conceptId === "C-01");
  const targetShareSum = intoC01.reduce((acc, e) => acc + e.wTarget, 0);
  assert.ok(Math.abs(targetShareSum - 1) < 1e-9, "a concept's incoming edges split its full share");
});

test("buildLayers reports unclaimed themes separately from the main graph", () => {
  const graph = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  // DistillNode's identifier field is `id` (a theme node's id IS its
  // theme code — see distill.ts's `nodesById.set(t.code, { id: t.code,
  // ... })`); DistillNode has no separate `code` field. Only DistillEdge
  // carries `.code` (the source theme) alongside `.conceptId` (the
  // target), since an edge connects two differently-typed nodes and needs
  // to name both ends.
  assert.deepEqual(graph.unclaimed.map((t) => t.id), ["NO_IMPACT"]);
  assert.ok(!graph.themeNodes.some((t) => t.id === "NO_IMPACT"));
});

test("buildLayers order is deterministic across repeated calls", () => {
  const a = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  const b = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  assert.deepEqual(a.themeNodes.map((t) => t.id), b.themeNodes.map((t) => t.id));
});

test("buildLayers orders theme nodes by their primary concept's position, breaking ties by descending count", () => {
  const graph = buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
  // REGULATE's only concept is C-01 (rooms.json order index 0); JOB_LOSS's
  // strongest concept is C-02 (primary, index 1) even though it also touches
  // C-01 secondarily — so REGULATE sorts before JOB_LOSS.
  assert.deepEqual(graph.themeNodes.map((t) => t.id), ["REGULATE", "JOB_LOSS"]);
});
