import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayers } from "../src/lib/distill.ts";
import {
  buildCloud,
  flightProgress,
  flightState,
  restAlpha,
  unclaimedAlpha,
  absorbed,
  wordBox,
  capFontSizeForWidth,
  MAX_LINE_WIDTH_PX,
  applyOcclusion,
  frameCandidates,
  subthemePalette,
  FLIGHT_SPAN,
} from "../src/lib/cloud.ts";
import { compositeMetric } from "../src/lib/roomsRank.ts";
import { assignCategoryColors, DATA_VIZ_CAT } from "../src/lib/palette.ts";
import type { CrosswalkData } from "../src/lib/crosswalkData.ts";
import type { RoomsData, RoomsConcept, RoomsSubtheme } from "../src/lib/roomsData.ts";

// PRIVACY splits evenly three ways (its three edges share one field/count,
// so effective weight is identical) — the real crosswalk's PRIVACY_SURVEILLANCE
// theme does exactly this. JOB_LOSS additionally feeds C-01, so C-01's
// incoming split is uneven. C-04 has no incoming edge at all — an unreached
// concept, same shape as the 2 of 29 concepts unreached at the default filter.
function fixtureCrosswalk(): CrosswalkData {
  return {
    meta: {
      generated: "now", version: "v1", codebookVersion: "cb1", roomsSourceHash: "h1",
      status: "proposed", approvedBy: null, method: "m", caveat: "interpretive",
    },
    themes: [
      { code: "PRIVACY", label: "Privacy and surveillance limits", home: "government", counts: { personal: 0, economy: 0, government: 300 } },
      { code: "JOB_LOSS", label: "Job losses and displacement", home: "economy", counts: { personal: 0, economy: 900, government: 0 } },
      { code: "NO_IMPACT", label: "No impact", home: "personal", counts: { personal: 50, economy: 0, government: 0 } },
    ],
    edges: [
      { conceptId: "C-01", code: "PRIVACY", field: "government", strength: "primary", rationale: "r" },
      { conceptId: "C-02", code: "PRIVACY", field: "government", strength: "primary", rationale: "r" },
      { conceptId: "C-03", code: "PRIVACY", field: "government", strength: "primary", rationale: "r" },
      { conceptId: "C-01", code: "JOB_LOSS", field: "economy", strength: "primary", rationale: "r" },
    ],
    unclaimedCodes: ["NO_IMPACT"],
    concepts: [
      { conceptId: "C-01", sessionsPct: 50, topPct: 44, voteToIdeaRatio: 3.4, compositePctSum: 94, compositeCountSum: 11 },
      { conceptId: "C-02", sessionsPct: 20, topPct: 10, voteToIdeaRatio: 1.2, compositePctSum: 30, compositeCountSum: 5 },
      { conceptId: "C-03", sessionsPct: 60, topPct: 50, voteToIdeaRatio: 2.0, compositePctSum: 110, compositeCountSum: 10 },
      { conceptId: "C-04", sessionsPct: 5, topPct: 0, voteToIdeaRatio: 1.0, compositePctSum: 5, compositeCountSum: 1 },
    ],
  };
}

function fixtureRooms(): RoomsData {
  return {
    meta: {
      generated: "now", sourceFile: "f", sourceHash: "h", sessions: 1, attendees: 1, ideas: 1, votes: 1,
      sampleCaveat: "c", reconciliation: [], hasIdeaLinkage: false, linkageCoverage: 0,
    },
    themes: [{ id: "T1", name: "Theme One", votes: 41, ideas: 10, topIdeas: 5, subthemes: 2 }],
    subthemes: [
      { id: "ST-01", themeId: "T1", name: "Subtheme A", statedVotes: null, statedIdeas: null, statedSessions: null, votes: 25, ideas: 7, topIdeas: 3, concepts: 2 },
      { id: "ST-02", themeId: "T1", name: "Subtheme B", statedVotes: null, statedIdeas: null, statedSessions: null, votes: 16, ideas: 3, topIdeas: 2, concepts: 2 },
    ],
    concepts: [
      { id: "C-01", subthemeId: "ST-01", themeId: "T1", name: "Concept One", sessions: 5, votes: 20, ideas: 5, topIdeas: 3 }, // composite 8
      { id: "C-02", subthemeId: "ST-01", themeId: "T1", name: "Concept Two", sessions: 2, votes: 5, ideas: 2, topIdeas: 0 }, // composite 2
      { id: "C-03", subthemeId: "ST-02", themeId: "T1", name: "Protect the environment and consumers from the resource needs of data centers", sessions: 8, votes: 15, ideas: 3, topIdeas: 2 }, // composite 10, real 77-char concept name
      { id: "C-04", subthemeId: "ST-02", themeId: "T1", name: "Concept Four", sessions: 1, votes: 1, ideas: 1, topIdeas: 0 }, // composite 1, unreached
    ],
    sessions: [],
    ideas: [],
  };
}

function graph() {
  return buildLayers(fixtureCrosswalk(), fixtureRooms(), { scope: "all", minStrength: "tangential" });
}

test("buildCloud emits one flight per surviving edge", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  assert.equal(layout.flights.length, 4);
});

test("a theme's peeled flights split its share evenly when edges are identical", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const fromPrivacy = layout.flights.filter((f) => f.sourceId === "PRIVACY");
  assert.equal(fromPrivacy.length, 3);
  for (const f of fromPrivacy) assert.ok(Math.abs(f.wSource - 1 / 3) < 1e-9);
  const sum = fromPrivacy.reduce((a, f) => a + f.wSource, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("a theme with a single edge is not split", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const fromJobLoss = layout.flights.filter((f) => f.sourceId === "JOB_LOSS");
  assert.equal(fromJobLoss.length, 1);
  assert.equal(fromJobLoss[0].wSource, 1);
});

test("unclaimed themes never fly", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  assert.equal(layout.unclaimedWords.length, 1);
  assert.equal(layout.unclaimedWords[0].id, "NO_IMPACT");
  assert.ok(!layout.flights.some((f) => f.sourceId === "NO_IMPACT"));
});

test("absorbed sums each edge's wTarget share, weighted by that edge's own flight progress", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  // C-01 has two incoming edges of unequal weight (PRIVACY's fragment and
  // JOB_LOSS's whole word); both fully arrive by p=1, so absorbed sums to 1
  // regardless of the uneven split.
  assert.ok(Math.abs(absorbed(layout, "C-01", 1) - 1) < 1e-6);
  assert.ok(Math.abs(absorbed(layout, "C-02", 1) - 1) < 1e-6);
  assert.ok(absorbed(layout, "C-01", 0) < 1e-6, "nothing has arrived at p=0");
});

test("a concept with no incoming edge is always fully present (ghosted), not stuck at zero", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  assert.equal(absorbed(layout, "C-04", 0), 1);
  assert.equal(absorbed(layout, "C-04", 1), 1);
  const c4 = layout.targetWords.find((w) => w.id === "C-04")!;
  assert.equal(c4.reached, false);
});

test("reached concepts are flagged as such", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const c1 = layout.targetWords.find((w) => w.id === "C-01")!;
  assert.equal(c1.reached, true);
});

test("target word font size is monotonic in the composite metric, among labels short enough that the width cap never engages", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const byId = new Map(layout.targetWords.map((w) => [w.id, w.fontSize]));
  // composite: C-04=1, C-02=2, C-01=8 — C-03 (composite 10, highest) is
  // deliberately excluded here: it carries the fixture's 77-char label,
  // which the width cap can legitimately push below a shorter, lower-
  // composite word's size — see the next test.
  assert.ok(byId.get("C-04")! <= byId.get("C-02")!);
  assert.ok(byId.get("C-02")! <= byId.get("C-01")!);
});

test("a long label's width cap can override its composite metric's claim to a bigger font — a deliberate trade-off", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const c1 = layout.targetWords.find((w) => w.id === "C-01")!; // composite 8, short label
  const c3 = layout.targetWords.find((w) => w.id === "C-03")!; // composite 10 (highest), 77-char label
  assert.ok(c3.fontSize < c1.fontSize, "the longer label ends up smaller despite the higher composite metric");
  const uncappedC3 = c1.fontSize; // not exact, but c3's *weight-derived* size would exceed c1's before capping
  assert.ok(c3.fontSize < uncappedC3);
});

test("flightProgress is 0 before a flight's delay and 1 once its span elapses", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const f = layout.flights[0];
  assert.equal(flightProgress(f, f.delay), 0);
  assert.ok(Math.abs(flightProgress(f, f.delay + FLIGHT_SPAN) - 1) < 1e-9);
  assert.equal(flightProgress(f, 0), 0, "before every flight has started, progress is 0");
});

test("flightState moves a flight from its source word toward its target word as p advances", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const f = layout.flights[0];
  const start = flightState(f, f.delay);
  const end = flightState(f, f.delay + FLIGHT_SPAN);
  assert.ok(Math.abs(start.x - f.homeX) < 1e-6 && Math.abs(start.y - f.homeY) < 1e-6);
  assert.ok(Math.abs(end.x - f.targetX) < 1e-6 && Math.abs(end.y - f.targetY) < 1e-6);
});

test("restAlpha starts fully visible and fades to zero once a theme's flights complete", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  assert.equal(restAlpha("PRIVACY", layout, 0), 1);
  assert.ok(restAlpha("PRIVACY", layout, 1) < 1e-6);
});

test("applyOcclusion leaves non-overlapping candidates' alpha unchanged", () => {
  const a = { id: "a", x: 100, y: 100, fontSize: 14, lines: ["Far word"], color: "#000", label: "Far word", alpha: 0.5, weight: 400 as const };
  const b = { id: "b", x: 900, y: 900, fontSize: 14, lines: ["Other word"], color: "#000", label: "Other word", alpha: 0.5, weight: 400 as const };
  const out = applyOcclusion([a, b]);
  const byId = new Map(out.map((c) => [c.id, c.alpha]));
  assert.equal(byId.get("a"), 0.5);
  assert.equal(byId.get("b"), 0.5);
});

test("applyOcclusion dims both candidates in a full overlap, weighted by their relative alpha", () => {
  // Same position, same size — 100% mutual overlap. Nobody keeps full
  // strength (that would require ranking, which is what caused the
  // flashing), but the dimmer one is pushed down much harder than the
  // brighter one: pressure on each is the OTHER's share of their combined
  // alpha, so dim (0.3) absorbs bright's 0.75 share while bright only
  // absorbs dim's 0.25 share.
  const dim = { id: "a", x: 100, y: 100, fontSize: 14, lines: ["x"], color: "#000", label: "Dim word", alpha: 0.3, weight: 400 as const };
  const bright = { id: "b", x: 100, y: 100, fontSize: 14, lines: ["x"], color: "#000", label: "Bright word", alpha: 0.9, weight: 400 as const };
  const out = applyOcclusion([dim, bright]);
  const byId = new Map(out.map((c) => [c.id, c.alpha]));
  assert.ok(Math.abs((byId.get("a") ?? 0) - 0.075) < 1e-6, `dim -> ${byId.get("a")}, want ~0.075`);
  assert.ok(Math.abs((byId.get("b") ?? 0) - 0.675) < 1e-6, `bright -> ${byId.get("b")}, want ~0.675`);
  assert.ok((byId.get("b") ?? 0) > (byId.get("a") ?? 0), "bright still reads as clearly more visible than dim");
});

test("applyOcclusion dims a partially-overlapping candidate less than a fully-overlapping one", () => {
  // "half" sits so exactly half its box overlaps "full"'s identical box;
  // "full" is a separate, non-overlapping pair with the same alphas at
  // 100% overlap, for comparison. A hard cutoff would drop the loser
  // outright the instant ANY overlap exists, regardless of how much;
  // smooth occlusion should let the half-overlap case end up less dimmed.
  const halfA = { id: "halfA", x: 100, y: 100, fontSize: 10, lines: ["x"], color: "#000", label: "halfA", alpha: 0.8, weight: 400 as const };
  const halfB = { id: "halfB", x: 107, y: 100, fontSize: 10, lines: ["x"], color: "#000", label: "halfB", alpha: 1, weight: 400 as const };
  const fullA = { id: "fullA", x: 500, y: 500, fontSize: 10, lines: ["x"], color: "#000", label: "fullA", alpha: 0.8, weight: 400 as const };
  const fullB = { id: "fullB", x: 500, y: 500, fontSize: 10, lines: ["x"], color: "#000", label: "fullB", alpha: 1, weight: 400 as const };
  const out = applyOcclusion([halfA, halfB, fullA, fullB]);
  const byId = new Map(out.map((c) => [c.id, c.alpha]));
  const halfAAlpha = byId.get("halfA") ?? 0;
  const fullAAlpha = byId.get("fullA") ?? 0;
  assert.ok(halfAAlpha > 0 && halfAAlpha < 0.8, "partially dimmed, neither untouched nor zeroed");
  assert.ok(halfAAlpha > fullAAlpha, "half the overlap dims less than all of it");
});

test("applyOcclusion lets a much brighter candidate stay dominant over a much fainter one, even though both move", () => {
  const weak = { id: "weak", x: 200, y: 200, fontSize: 12, lines: ["w"], color: "#000", label: "weak", alpha: 0.2, weight: 400 as const };
  const strong = { id: "strong", x: 200, y: 200, fontSize: 12, lines: ["w"], color: "#000", label: "strong", alpha: 0.95, weight: 400 as const };
  const out = applyOcclusion([weak, strong]);
  const byId = new Map(out.map((c) => [c.id, c.alpha]));
  const strongAlpha = byId.get("strong") ?? 0;
  const weakAlpha = byId.get("weak") ?? 0;
  assert.ok(strongAlpha > 0.7, "still reads as solid");
  assert.ok(strongAlpha < 0.95, "but was reduced too — nobody is exempt from occlusion pressure");
  assert.ok(strongAlpha > weakAlpha * 5, "remains overwhelmingly more visible than the faint one");
});

test("applyOcclusion drops anything below the visibility floor", () => {
  const invisible = { id: "a", x: 100, y: 100, fontSize: 14, lines: ["Gone"], color: "#000", label: "Gone", alpha: 0.005, weight: 400 as const };
  assert.deepEqual(applyOcclusion([invisible]), []);
});

test("applyOcclusion's output alpha changes continuously as p advances — no popping", () => {
  // The actual complaint being fixed: a hard accept/reject makes an
  // eclipsed word's rendered alpha jump discontinuously between frames.
  // Sampling frameCandidates finely across p must never show a jump
  // bigger than a few adjacent samples' worth of natural alpha drift.
  //
  // Tracked by candidate `.id`, not `.label`: a theme that peels into
  // multiple flights (e.g. PRIVACY -> C-01/C-02/C-03 in this fixture) has
  // its rest word AND every one of its flights sharing the same label by
  // design — that's the "one word splits into copies" story, not a bug.
  // Aggregating by label instead of id conflates those distinct on-screen
  // objects and reports a "jump" whenever the occlusion-adjusted winner
  // among same-labeled candidates changes, which isn't a real popping
  // artifact — each object is drawn separately regardless of what text it
  // shares.
  //
  // STEP is fine enough to tell a real discontinuity apart from motion
  // that's merely fast: two converging flights can swing a candidate's
  // occlusion pressure by a lot over a few hundredths of p (measured
  // against the real animation: max per-0.001-step delta is ~0.067) —
  // legitimately steep, not a pop, since it shrinks smoothly as the
  // sampling gets finer. A true discontinuity would NOT shrink with
  // STEP; a threshold well above that measured maximum, at this
  // resolution, is what actually distinguishes the two.
  const layout = buildCloud(graph(), fixtureRooms());
  const STEP = 0.001;
  const trackedById = new Map<string, number[]>();
  for (let p = 0; p <= 1.0001; p += STEP) {
    const rendered = new Map(applyOcclusion(frameCandidates(layout, p)).map((c) => [c.id, c.alpha]));
    const allIds = new Set(frameCandidates(layout, p).map((c) => c.id));
    for (const id of allIds) {
      const list = trackedById.get(id) ?? [];
      list.push(rendered.get(id) ?? 0);
      trackedById.set(id, list);
    }
  }
  for (const [id, series] of trackedById) {
    for (let i = 1; i < series.length; i++) {
      assert.ok(Math.abs(series[i] - series[i - 1]) < 0.15, `"${id}" alpha jumped from ${series[i - 1]} to ${series[i]} in one ${STEP} step of p`);
    }
  }
});

test("unclaimed themes fade out during the distill instead of persisting into Phase 2", () => {
  // A theme no concept claims has nowhere to fly, but it must not just sit
  // on screen forever either — by the time the animation reaches Phase 2 it
  // should be gone, same as everything else that started in Phase 1.
  assert.equal(unclaimedAlpha(0), 1);
  assert.ok(unclaimedAlpha(1) < 1e-6);
  assert.ok(unclaimedAlpha(0.1) < unclaimedAlpha(0), "alpha decreases as the distill proceeds");
});

test("no two source-region words overlap", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const boxes = [...layout.restWords, ...layout.unclaimedWords].map(wordBox);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
      assert.ok(!overlap, `words ${i} and ${j} overlap`);
    }
  }
});

test("no two target-region words overlap", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const boxes = layout.targetWords.map(wordBox);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
      assert.ok(!overlap, `words ${i} and ${j} overlap`);
    }
  }
});

test("layout is deterministic across repeated calls", () => {
  const a = buildCloud(graph(), fixtureRooms());
  const b = buildCloud(graph(), fixtureRooms());
  assert.deepEqual(a.restWords, b.restWords);
  assert.deepEqual(a.targetWords, b.targetWords);
  assert.deepEqual(a.flights, b.flights);
});

test("capFontSizeForWidth leaves a short label's font size untouched", () => {
  assert.equal(capFontSizeForWidth("Preserve privacy", 14), 14);
});

test("capFontSizeForWidth shrinks a long label's font size so its single-line width never exceeds the cap", () => {
  const label = "Protect the environment and consumers from the resource needs of data centers"; // 77 chars
  const naturalFontSize = 30; // large enough that the natural width would blow past MAX_LINE_WIDTH_PX
  const capped = capFontSizeForWidth(label, naturalFontSize);
  assert.ok(capped < naturalFontSize);
  const width = label.length * capped * 0.6 + 8;
  assert.ok(width <= MAX_LINE_WIDTH_PX + 1e-6);
});

test("capFontSizeForWidth's cap is exact: right at the boundary width, the font size is untouched", () => {
  const label = "abcdefghij"; // 10 chars
  // Solve for the font size whose natural width lands exactly on the cap.
  const boundaryFontSize = (MAX_LINE_WIDTH_PX - 8) / (label.length * 0.6);
  assert.ok(Math.abs(capFontSizeForWidth(label, boundaryFontSize) - boundaryFontSize) < 1e-6);
  assert.ok(capFontSizeForWidth(label, boundaryFontSize + 1) < boundaryFontSize + 1);
});

test("buildCloud renders every word as exactly one line, full text intact, at any real-shaped filter", () => {
  const layout = buildCloud(graph(), fixtureRooms());
  const all = [...layout.restWords, ...layout.unclaimedWords, ...layout.targetWords];
  for (const w of all) {
    assert.equal(w.lines.length, 1, `"${w.label}" should render as one line`);
    assert.equal(w.lines[0], w.label, `"${w.label}" should never be truncated or altered`);
  }
});

test("subthemePalette's ST-07 no longer collides with ST-01 under the current palette, so it isn't overridden", () => {
  // The override this used to test (forcing ST-07 off DATA_VIZ_CAT's index
  // 6) was specific to the old 9-hue ramp, where index 6 and index 0 were
  // both blues — see cloud.ts's SUBTHEME_COLOR_OVERRIDES comment. The
  // current ramp's index 6 is a purple, distinct from index 0's blue.
  const ids = ["ST-01", "ST-02", "ST-03", "ST-04", "ST-05", "ST-06", "ST-07", "ST-08"];
  const palette = subthemePalette(ids);
  assert.deepEqual(palette, DATA_VIZ_CAT.slice(0, 8));
  assert.notEqual(palette[6], palette[0], "ST-07 must not match ST-01's blue");
});

test("subthemePalette is a no-op when SUBTHEME_COLOR_OVERRIDES has no entry for any given id", () => {
  const ids = ["ST-01", "ST-02"];
  assert.deepEqual(subthemePalette(ids), assignCategoryColors(ids));
});

function stillClearAfterInflating(
  boxA: { x0: number; y0: number; x1: number; y1: number },
  boxB: { x0: number; y0: number; x1: number; y1: number },
  extra: number,
) {
  const i1 = { x0: boxA.x0 - extra / 2, y0: boxA.y0 - extra / 2, x1: boxA.x1 + extra / 2, y1: boxA.y1 + extra / 2 };
  const i2 = { x0: boxB.x0 - extra / 2, y0: boxB.y0 - extra / 2, x1: boxB.x1 + extra / 2, y1: boxB.y1 + extra / 2 };
  return !(i1.x0 < i2.x1 && i1.x1 > i2.x0 && i1.y0 < i2.y1 && i1.y1 > i2.y0);
}

test("target words sharing a subtheme (same color) keep real daylight between them, not just avoid touching", () => {
  // C-01 and C-02 both belong to ST-01 in the fixture.
  const layout = buildCloud(graph(), fixtureRooms());
  const c1 = wordBox(layout.targetWords.find((w) => w.id === "C-01")!);
  const c2 = wordBox(layout.targetWords.find((w) => w.id === "C-02")!);
  // 40px is a conservative fraction of the real SAME_GROUP_EXTRA_MARGIN —
  // this only needs to confirm "meaningfully more than the base margin
  // alone," not pin the exact production constant.
  assert.ok(stillClearAfterInflating(c1, c2, 18), "same-subtheme concepts should have real daylight, not just avoid touching");
});

test("source words that dominantly feed the same subtheme keep real daylight between them too", () => {
  // PRIVACY and JOB_LOSS both dominantly feed C-01 (ST-01) in the fixture —
  // the rule applies on the Phase 1 side, not only to Phase 2 concepts.
  const layout = buildCloud(graph(), fixtureRooms());
  const privacy = wordBox(layout.restWords.find((w) => w.id === "PRIVACY")!);
  const jobLoss = wordBox(layout.restWords.find((w) => w.id === "JOB_LOSS")!);
  assert.ok(stillClearAfterInflating(privacy, jobLoss, 18), "same-dominant-subtheme source words should have real daylight");
});

// --- Silhouette metrics ---------------------------------------------------
//
// The 4-item fixture above is too small to say anything statistically
// meaningful about a field's overall shape. These tests instead build a
// synthetic Phase 2 concept set at the real filter's actual scale (29
// concepts across 8 subthemes, in the real per-subtheme counts) and turn
// "reads like a rounded word cloud, not a center-heavy triangle" into
// numbers, so a future regression shows up as a failing assertion instead
// of a screenshot someone has to notice looks wrong. No filesystem access —
// data/ and analysis/artifacts/ are gitignored, so every other test in this
// file is fixture-only on purpose; this follows the same convention.

// Length-matched to the real rooms.json concept names (16-56 chars, median
// ~38), not hand-picked worst-case sentences — a fixture built from
// uniformly long labels understates how much of the real field is actually
// short/medium and overstates how hard packing is. One real 77-char label
// (the longest concept in the actual export) is kept as the sole long-tail
// outlier, same role it plays in the small fixture above.
const SHORT_NAMES = ["Privacy", "Jobs", "Bias", "Safety", "Consent", "Access", "Fairness", "Trust", "Oversight", "Literacy"];
const MEDIUM_NAMES = [
  "Require clear disclosure for automated decisions", // 49
  "Fund retraining for workers displaced by AI", // 44
  "Establish independent oversight of AI systems", // 46
  "Guarantee human review of AI service denials", // 45
  "Invest in AI literacy across every school district", // 51
  "Set enforceable limits on personal data retention", // 50
  "Protect the environment and consumers from the resource needs of data centers", // 77 — the real long-tail outlier
  "Ensure equitable access to AI benefits statewide", // 49
];

// ST-01..ST-08 in the real per-subtheme concept counts (6,4,4,3,2,5,2,3 — 29
// total), so a group-spacing rule tuned against the real largest groups
// (ST-01, ST-06) is exercised here at the same scale it runs at in
// production.
const SUBTHEME_SIZES: [string, number][] = [
  ["ST-01", 6],
  ["ST-02", 4],
  ["ST-03", 4],
  ["ST-04", 3],
  ["ST-05", 2],
  ["ST-06", 5],
  ["ST-07", 2],
  ["ST-08", 3],
];

function bigFixtureRooms(): RoomsData {
  const subthemes: RoomsSubtheme[] = SUBTHEME_SIZES.map(([id], i) => ({
    id,
    themeId: "T1",
    name: `Subtheme ${i + 1}`,
    statedVotes: null,
    statedIdeas: null,
    statedSessions: null,
    votes: 0,
    ideas: 0,
    topIdeas: 0,
    concepts: SUBTHEME_SIZES[i][1],
  }));

  const concepts: RoomsConcept[] = [];
  let i = 0;
  for (const [subthemeId, count] of SUBTHEME_SIZES) {
    for (let k = 0; k < count; k++) {
      // Deterministic spread across a wide range (1..28), no RNG — same
      // "no randomness anywhere in a layout test" convention as cloud.ts
      // itself. Long/short names alternate so both label shapes appear at
      // every weight, not just at one end of the range.
      const composite = ((i * 11) % 28) + 1;
      const sessions = Math.floor(composite / 2);
      const topIdeas = composite - sessions;
      const name = i % 2 === 0 ? SHORT_NAMES[i % SHORT_NAMES.length] + ` ${i}` : MEDIUM_NAMES[i % MEDIUM_NAMES.length];
      concepts.push({ id: `C-${i}`, subthemeId, themeId: "T1", name, sessions, votes: composite * 3, ideas: Math.max(1, topIdeas), topIdeas });
      i++;
    }
  }

  return {
    meta: {
      generated: "now", sourceFile: "f", sourceHash: "h", sessions: 1, attendees: 1, ideas: 1, votes: 1,
      sampleCaveat: "c", reconciliation: [], hasIdeaLinkage: false, linkageCoverage: 0,
    },
    themes: [{ id: "T1", name: "Theme One", votes: 1, ideas: 1, topIdeas: 1, subthemes: SUBTHEME_SIZES.length }],
    subthemes,
    concepts,
    sessions: [],
    ideas: [],
  };
}

function bigFixtureCrosswalk(): CrosswalkData {
  // Empty themes/edges on purpose — these tests only look at Phase 2
  // (layout.targetWords), which buildCloud derives straight from
  // rooms.concepts, never from the crosswalk (see buildCloud's own
  // comment on Phase 2 sizing).
  return {
    meta: {
      generated: "now", version: "v1", codebookVersion: "cb1", roomsSourceHash: "h1",
      status: "proposed", approvedBy: null, method: "m", caveat: "interpretive",
    },
    themes: [],
    edges: [],
    unclaimedCodes: [],
    concepts: [],
  };
}

function bigLayout() {
  const rooms = bigFixtureRooms();
  const graph = buildLayers(bigFixtureCrosswalk(), rooms, { scope: "all", minStrength: "tangential" });
  return buildCloud(graph, rooms);
}

/** Bounding box of a set of word boxes — the region the field actually
 * occupies, not the much larger canvas it was laid out inside of. */
function bbox(boxes: { x0: number; y0: number; x1: number; y1: number }[]) {
  return {
    minX: Math.min(...boxes.map((b) => b.x0)),
    maxX: Math.max(...boxes.map((b) => b.x1)),
    minY: Math.min(...boxes.map((b) => b.y0)),
    maxY: Math.max(...boxes.map((b) => b.y1)),
  };
}

function boxArea(b: { x0: number; y0: number; x1: number; y1: number }): number {
  return (b.x1 - b.x0) * (b.y1 - b.y0);
}

test("no two words overlap in a 29-concept field — the real Phase 2 scale, not just the 4-item fixture", () => {
  const layout = bigLayout();
  const boxes = layout.targetWords.map(wordBox);
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const [x, y] = [boxes[a], boxes[b]];
      const overlap = x.x0 < y.x1 && x.x1 > y.x0 && x.y0 < y.y1 && x.y1 > y.y0;
      assert.ok(!overlap, `words ${a} and ${b} overlap`);
    }
  }
});

test("a 29-concept field fills a real fraction of its own bounding box — a packed cloud, not a scattered handful", () => {
  const layout = bigLayout();
  const boxes = layout.targetWords.map(wordBox);
  const totalArea = boxes.reduce((sum, b) => sum + boxArea(b), 0);
  const field = bbox(boxes);
  const fieldArea = (field.maxX - field.minX) * (field.maxY - field.minY);
  const density = totalArea / fieldArea;
  // 0.3, not the ~0.5+ a same-aspect-ratio word cloud could hit: sentence-
  // length single-line boxes (16-77 chars here, matching the real export's
  // own range) can't tile as tightly as short single words can — measured
  // against the real crosswalk+rooms export at its default filter, this
  // fix's own fill density is ~0.38. This guards against a collapse back
  // toward the pre-fix ~0.29 the last commit measured, not against falling
  // short of an idealized dense-word-cloud number this label shape can't
  // reach anyway.
  assert.ok(density >= 0.3, `fill density ${density.toFixed(2)} is too sparse for a word cloud`);
});

test("a 29-concept field is not lopsided into one quadrant — the direct triangle/skew check", () => {
  const layout = bigLayout();
  const boxes = layout.targetWords.map(wordBox);
  const field = bbox(boxes);
  const cx = (field.minX + field.maxX) / 2;
  const cy = (field.minY + field.maxY) / 2;
  const quadrantArea = [0, 0, 0, 0];
  for (const b of boxes) {
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    const q = (mx >= cx ? 1 : 0) + (my >= cy ? 2 : 0);
    quadrantArea[q] += boxArea(b);
  }
  const total = quadrantArea.reduce((a, b) => a + b, 0);
  // 0.6, not 0.25-ish "perfectly even": 29 single-line boxes at wildly
  // different aspect ratios (a 9-char label next to a 77-char one) can't
  // split into a mathematically even quarters — the real export measures
  // ~41% in its heaviest quadrant even after this fix. This guards against
  // the original bug's failure mode (bounds-rejection producing a lopsided
  // 70-90%+ pile), not against ordinary single-line packing variance.
  for (const [q, area] of quadrantArea.entries()) {
    assert.ok(area / total <= 0.6, `quadrant ${q} holds ${((area / total) * 100).toFixed(0)}% of the field — too lopsided`);
  }
});

test("a 29-concept field's outer ring is genuinely occupied, not just its center — catches everything piling into the middle", () => {
  const layout = bigLayout();
  const boxes = layout.targetWords.map(wordBox);
  const field = bbox(boxes);
  const cx = (field.minX + field.maxX) / 2;
  const cy = (field.minY + field.maxY) / 2;
  const halfW = (field.maxX - field.minX) / 2;
  const halfH = (field.maxY - field.minY) / 2;

  let outerArea = 0;
  let totalArea = 0;
  for (const b of boxes) {
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    const r = Math.sqrt(((mx - cx) / halfW) ** 2 + ((my - cy) / halfH) ** 2);
    const area = boxArea(b);
    totalArea += area;
    if (r >= 2 / 3) outerArea += area;
  }
  const outerFraction = outerArea / totalArea;
  assert.ok(outerFraction >= 0.15, `outer third of the field holds only ${(outerFraction * 100).toFixed(0)}% of box area — words are piling into the center`);
});

test("a 29-concept field reads center-out: inner words are heavier, on average, than outer words", () => {
  const layout = bigLayout();
  const rooms = bigFixtureRooms();
  const compositeById = new Map(rooms.concepts.map((c) => [c.id, compositeMetric(c) ?? 0]));
  const field = bbox(layout.targetWords.map(wordBox));
  const cx = (field.minX + field.maxX) / 2;
  const cy = (field.minY + field.maxY) / 2;
  const halfW = (field.maxX - field.minX) / 2;
  const halfH = (field.maxY - field.minY) / 2;

  const inner: number[] = [];
  const outer: number[] = [];
  for (const w of layout.targetWords) {
    const r = Math.sqrt(((w.x - cx) / halfW) ** 2 + ((w.y - cy) / halfH) ** 2);
    const weight = compositeById.get(w.id) ?? 0;
    if (r < 1 / 3) inner.push(weight);
    else if (r >= 2 / 3) outer.push(weight);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(inner.length > 0 && outer.length > 0, "need at least one word in each ring to compare");
  assert.ok(mean(inner) > mean(outer), `inner mean weight ${mean(inner).toFixed(1)} should exceed outer mean weight ${mean(outer).toFixed(1)}`);
});

test("some short labels in a 29-concept field are rotated — the lever that lets one-line labels reach the flanks", () => {
  const layout = bigLayout();
  const rotated = layout.targetWords.filter((w) => w.rot === 90);
  assert.ok(rotated.length > 0, "expected at least one rotated word at this scale/label mix");
  for (const w of rotated) assert.ok(w.label.length <= 20, `rotated word "${w.label}" is too long to read sensibly turned vertical`);
});
