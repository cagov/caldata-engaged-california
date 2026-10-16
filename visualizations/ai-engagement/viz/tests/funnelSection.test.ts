import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_HEADING, buildSelectionStages, SELECTION_STAGE_COUNT, libStageFor, headerCrossfade, selectionStageBands, selectionYShift } from "../src/lib/funnelSection.ts";
import { buildFunnelCloud, dotTarget, CANVAS, type FunnelData } from "../src/lib/funnelCloud.ts";

function fixtureData(): FunnelData {
  return {
    phase1Total: 20,
    regions: [
      { name: "Bay Area", surveyCount: 12, attendCount: 2 },
      { name: "Los Angeles", surveyCount: 8, attendCount: 1 },
    ],
    fieldOfWork: [
      { name: "Government", surveyCount: 15, attendCount: 2 },
      { name: "Healthcare", surveyCount: 5, attendCount: 1 },
    ],
    sessions: [
      {
        date: "2026-07-15",
        attendees: [
          { region: "Bay Area", fieldOfWork: "Government" },
          { region: "Bay Area", fieldOfWork: "Healthcare" },
        ],
      },
      {
        date: "2026-07-09",
        attendees: [{ region: "Los Angeles", fieldOfWork: "Government" }],
      },
    ],
    invitedByRegion: [
      { name: "Bay Area", count: 5 },
      { name: "Los Angeles", count: 2 },
    ],
    invitedTotal: 7,
  };
}

test("SECTION_HEADING is the mockup's constant heading", () => {
  assert.equal(SECTION_HEADING, "Who participated");
});

test("buildSelectionStages returns exactly SELECTION_STAGE_COUNT stages", () => {
  assert.equal(buildSelectionStages(fixtureData()).length, SELECTION_STAGE_COUNT);
  assert.equal(SELECTION_STAGE_COUNT, 4);
});

test("buildSelectionStages derives every hero number from the export, not hardcoded comms copy", () => {
  const [phase1, selected, phase2, conversations] = buildSelectionStages(fixtureData());

  assert.equal(phase1.phase, "Phase 1");
  assert.equal(phase1.title, "Broad listening");
  assert.equal(phase1.sub, "Californians responded to our open survey on AI");
  assert.equal(phase1.info, false);
  assert.deepEqual(phase1.stat, { icon: "people", value: "20", caption: "survey respondents" });

  assert.equal(selected.title, "Inviting a balanced audience");
  assert.equal(selected.info, false);
  assert.deepEqual(selected.stat, { icon: "people", value: "7", caption: "invited" });

  assert.equal(phase2.title, "Joining the conversation");
  assert.equal(phase2.info, false);
  assert.deepEqual(phase2.stat, { icon: "people", value: "3", caption: "attended" });

  assert.equal(conversations.phase, "Phase 2");
  assert.equal(conversations.title, "The discussion groups");
  assert.equal(conversations.info, false);
  assert.deepEqual(conversations.stat, { icon: "chats", value: "2", caption: "conversations" });
});

test("buildSelectionStages formats hero values with thousands separators", () => {
  const data = fixtureData();
  data.phase1Total = 2678;
  data.invitedTotal = 948;
  const [phase1, selected] = buildSelectionStages(data);
  assert.equal(phase1.stat?.value, "2,678");
  assert.equal(selected.stat?.value, "948");
});

test("buildSelectionStages' pill labels match the existing stage-jump convention", () => {
  assert.deepEqual(
    buildSelectionStages(fixtureData()).map((s) => s.pill),
    ["1 · Phase 1", "2 · Selected", "3 · Phase 2", "4 · Conversations"],
  );
});

test("libStageFor maps this section's 4 stages onto funnelCloud.ts's stage numbering", () => {
  assert.deepEqual([0, 1, 2, 3].map(libStageFor), [0, 2, 3, 4]);
});

test("libStageFor(0) lands on the drifting cloud stage — dots not yet split into kept/dropped", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const dropped = layout.dots.find((d) => !d.kept)!;
  const gKept = dotTarget(kept, libStageFor(0), "region", layout.clusters, 0, 0.3, 0.2);
  const gDropped = dotTarget(dropped, libStageFor(0), "region", layout.clusters, 0, 0.3, 0.2);
  assert.equal(gKept.alpha, gDropped.alpha, "stage 0 (cloud) doesn't yet distinguish kept from dropped");
  assert.equal(gKept.person, false);
});

test("libStageFor(1) lands on the 'Selected' stage — kept dots stay bright, dropped dots dim", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const dropped = layout.dots.find((d) => !d.kept)!;
  const gKept = dotTarget(kept, libStageFor(1), "region", layout.clusters, 0, 0.3, 0.2);
  const gDropped = dotTarget(dropped, libStageFor(1), "region", layout.clusters, 0, 0.3, 0.2);
  assert.equal(gKept.alpha, 1);
  assert.ok(gDropped.alpha < gKept.alpha);
});

test("libStageFor(2) lands on the Phase 2 gather stage — kept dots draw as person glyphs", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const g = dotTarget(kept, libStageFor(2), "region", layout.clusters, 0, 0.3, 0.2);
  assert.equal(g.person, true);
});

test("libStageFor(3) lands on the conversation-ring stage — kept dots orbit their cluster, no person glyph", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const g = dotTarget(kept, libStageFor(3), "region", layout.clusters, 0, 0.3, 0.2);
  assert.equal(g.person, false);
  assert.equal(g.alpha, 1);
});

test("headerCrossfade shows the 'from' stage before the midpoint and the 'to' stage after it", () => {
  assert.equal(headerCrossfade(0).useTo, false);
  assert.equal(headerCrossfade(0.2).useTo, false);
  assert.equal(headerCrossfade(1).useTo, true);
});

test("headerCrossfade's opacity is 1 at both ends of the transition and dips at the midpoint", () => {
  assert.equal(headerCrossfade(0).opacity, 1);
  assert.equal(headerCrossfade(1).opacity, 1);
  const mid = headerCrossfade(0.5 / 1.6).opacity; // k === 0.5 exactly
  assert.ok(mid < 0.05, `expected opacity near 0 at the crossfade midpoint, got ${mid}`);
});

// Real 14-session shape from the current funnel.json export — same fixture
// shape as funnelCloud.test.ts's own realShapeData(), duplicated here since
// that one is module-private. The vertical-centering invariants below only
// matter at this real scale: fixtureData()'s tiny 20-dot/2-session cloud
// doesn't exercise the ring-is-tallest constraint ParticipantFunnelSelection
// .svelte's BOTTOM_TRIM is tuned against.
function realShapeData(): FunnelData {
  const sizes = [12, 12, 11, 8, 8, 7, 7, 7, 6, 5, 5, 5, 5, 5];
  const attendCount = sizes.reduce((a, b) => a + b, 0);
  return {
    phase1Total: 2702,
    regions: [{ name: "Bay Area", surveyCount: 2702, attendCount }],
    fieldOfWork: [{ name: "Government", surveyCount: 2702, attendCount }],
    sessions: sizes.map((n, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      attendees: Array.from({ length: n }, () => ({ region: "Bay Area", fieldOfWork: "Government" })),
    })),
    invitedByRegion: [{ name: "Bay Area", count: attendCount }],
    invitedTotal: attendCount,
  };
}

// Mirrors ParticipantFunnelSelection.svelte's own VIEW_TOP/VIEW_BOTTOM/
// DOT_TOP/DOT_BOTTOM constants (not exported — they're component-local
// tuning, not lib API) so these tests exercise the same target band the
// component actually centers into.
const TOP_TRIM = 120;
const BOTTOM_TRIM = 56;
const VIEW_BOTTOM = CANVAS.H - BOTTOM_TRIM;
const BAND_H = 100;
const DOT_TOP = TOP_TRIM + 6;
const DOT_BOTTOM = VIEW_BOTTOM - BAND_H;

test("selectionStageBands: every stage's band has positive height, and at the real 14-session shape the conversation ring is the tallest", () => {
  const bands = selectionStageBands(buildFunnelCloud(realShapeData()));
  assert.equal(bands.length, SELECTION_STAGE_COUNT);
  for (const b of bands) assert.ok(b.bottom > b.top, `band [${b.top}, ${b.bottom}] should have positive height`);

  const heights = bands.map((b) => b.bottom - b.top);
  const ringHeight = heights[SELECTION_STAGE_COUNT - 1];
  for (let i = 0; i < heights.length - 1; i++) {
    assert.ok(ringHeight >= heights[i], `expected the ring band (${ringHeight}px) to be at least as tall as stage ${i}'s band (${heights[i]}px)`);
  }
});

test("selectionYShift centers every stage's band on the same line within [DOT_TOP, DOT_BOTTOM]", () => {
  const bands = selectionStageBands(buildFunnelCloud(realShapeData()));
  const shift = selectionYShift(bands, DOT_TOP, DOT_BOTTOM);
  const targetCenter = (DOT_TOP + DOT_BOTTOM) / 2;

  bands.forEach((b, i) => {
    const shiftedTop = b.top + shift[i];
    const shiftedBottom = b.bottom + shift[i];
    const shiftedCenter = (shiftedTop + shiftedBottom) / 2;
    assert.ok(Math.abs(shiftedCenter - targetCenter) < 1e-6, `stage ${i}'s shifted center (${shiftedCenter}) should equal the target center (${targetCenter})`);
  });
});

test("selectionYShift keeps every shifted band inside [DOT_TOP, DOT_BOTTOM]", () => {
  const bands = selectionStageBands(buildFunnelCloud(realShapeData()));
  const shift = selectionYShift(bands, DOT_TOP, DOT_BOTTOM);

  bands.forEach((b, i) => {
    const shiftedTop = b.top + shift[i];
    const shiftedBottom = b.bottom + shift[i];
    assert.ok(shiftedTop >= DOT_TOP - 1e-6, `stage ${i}'s shifted top (${shiftedTop}) should be inside DOT_TOP (${DOT_TOP})`);
    assert.ok(shiftedBottom <= DOT_BOTTOM + 1e-6, `stage ${i}'s shifted bottom (${shiftedBottom}) should be inside DOT_BOTTOM (${DOT_BOTTOM})`);
  });
});

test("selectionYShift is a no-op (0) for a band already centered on the target", () => {
  const target = { top: 100, bottom: 300 };
  const shift = selectionYShift([target], 100, 300);
  assert.equal(shift[0], 0);
});

test("the ring's shifted bottom edge sits above the category legend's first row, leaving room for the Participant/Facilitator key between them", () => {
  const bands = selectionStageBands(buildFunnelCloud(realShapeData()));
  const shift = selectionYShift(bands, DOT_TOP, DOT_BOTTOM);
  const ringBottomY = bands[SELECTION_STAGE_COUNT - 1].bottom + shift[SELECTION_STAGE_COUNT - 1];

  // Mirrors categoryLegend()'s own anchor (ParticipantFunnelSelection.svelte)
  // for a real 2-row legend (Field of work wraps to 2 rows at the real
  // export's category count) — the tightest real case, since a 1-row legend
  // (Region) would only leave more headroom above it.
  const nRows = 2;
  const legendTopY = VIEW_BOTTOM - 22 - 24 * (nRows - 1);
  assert.ok(ringBottomY < legendTopY, `expected the ring's bottom (${ringBottomY}) to sit above the legend's first row (${legendTopY})`);

  const keyRowY = (ringBottomY + legendTopY) / 2;
  assert.ok(
    keyRowY > DOT_BOTTOM && keyRowY < legendTopY,
    `expected the key row (${keyRowY}) to sit strictly between DOT_BOTTOM (${DOT_BOTTOM}) and the legend's first row (${legendTopY})`,
  );
});
