import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFunnelCloud, dotTarget, orbitPosition, STAGE_COUNT, RING_SHIFT_X, PULSE_AMPLITUDE, PULSE_ROTATE_FRACTION, type FunnelData } from "../src/lib/funnelCloud.ts";
import { personWidthFor, personHeightFor } from "../src/lib/personGlyph.ts";

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

test("buildFunnelCloud creates exactly phase1Total dots", () => {
  const layout = buildFunnelCloud(fixtureData());
  assert.equal(layout.dots.length, 20);
});

test("buildFunnelCloud marks exactly as many dots kept as there are real attendees across sessions", () => {
  const layout = buildFunnelCloud(fixtureData());
  assert.equal(layout.keptTotal, 3);
  assert.equal(layout.dots.filter((d) => d.kept).length, 3);
});

test("buildFunnelCloud's kept dots carry a real attendee's joint (region, fieldOfWork) pair, not independent draws", () => {
  const data = fixtureData();
  const layout = buildFunnelCloud(data);
  const keptPairs = layout.dots.filter((d) => d.kept).map((d) => `${d.region}|${d.fieldOfWork}`);
  const realPairs = data.sessions.flatMap((s) => s.attendees.map((a) => `${a.region}|${a.fieldOfWork}`));
  assert.deepEqual(keptPairs.sort(), realPairs.sort());
});

test("buildFunnelCloud's dropped dots' region totals equal survey minus attend counts", () => {
  const layout = buildFunnelCloud(fixtureData());
  const dropped = layout.dots.filter((d) => !d.kept);
  const bayArea = dropped.filter((d) => d.region === "Bay Area").length;
  const losAngeles = dropped.filter((d) => d.region === "Los Angeles").length;
  assert.equal(bayArea, 12 - 2);
  assert.equal(losAngeles, 8 - 1);
});

test("buildFunnelCloud's dropped dots' field-of-work totals equal survey minus attend counts", () => {
  const layout = buildFunnelCloud(fixtureData());
  const dropped = layout.dots.filter((d) => !d.kept);
  const government = dropped.filter((d) => d.fieldOfWork === "Government").length;
  const healthcare = dropped.filter((d) => d.fieldOfWork === "Healthcare").length;
  assert.equal(government, 15 - 2);
  assert.equal(healthcare, 5 - 1);
});

test("buildFunnelCloud groups kept dots into clusters matching each session's real attendee count", () => {
  const layout = buildFunnelCloud(fixtureData());
  assert.equal(layout.clusters.length, 2);
  assert.equal(layout.clusters[0].n, 2);
  assert.equal(layout.clusters[1].n, 1);
  const inCluster0 = layout.dots.filter((d) => d.group === 0).length;
  const inCluster1 = layout.dots.filter((d) => d.group === 1).length;
  assert.equal(inCluster0, 2);
  assert.equal(inCluster1, 1);
});

test("buildFunnelCloud is deterministic across calls", () => {
  const data = fixtureData();
  const a = buildFunnelCloud(data);
  const b = buildFunnelCloud(data);
  assert.deepEqual(
    a.dots.map((d) => d.cloud.x),
    b.dots.map((d) => d.cloud.x),
  );
  assert.deepEqual(
    a.dots.map((d) => d.region),
    b.dots.map((d) => d.region),
  );
});

test("dotTarget stage 0 places every dot near its cloud position regardless of kept status", () => {
  const layout = buildFunnelCloud(fixtureData());
  const dropped = layout.dots.find((d) => !d.kept)!;
  const target = dotTarget(dropped, 0, "region", layout.clusters, 0, 0.3, 0.34);
  assert.equal(target.alpha, 0.62);
  assert.equal(target.categoryKey, dropped.region);
});

test("dotTarget stage 1 (Phase 1 concepts, dots view) matches stage 0 exactly", () => {
  const layout = buildFunnelCloud(fixtureData());
  for (const dot of layout.dots) {
    const stage0 = dotTarget(dot, 0, "region", layout.clusters, 1.2, 0.3, 0.34);
    const stage1 = dotTarget(dot, 1, "region", layout.clusters, 1.2, 0.3, 0.34);
    assert.deepEqual(stage1, stage0);
  }
});

test("dotTarget stage 2 dims dropped dots and tags them with the sentinel category", () => {
  const layout = buildFunnelCloud(fixtureData());
  const dropped = layout.dots.find((d) => !d.kept)!;
  const kept = layout.dots.find((d) => d.kept)!;
  assert.equal(dotTarget(dropped, 2, "region", layout.clusters, 0, 0.3, 0.34).categoryKey, "__dropped");
  assert.equal(dotTarget(kept, 2, "region", layout.clusters, 0, 0.3, 0.34).categoryKey, kept.region);
});

test("buildFunnelCloud marks every kept dot as invited — invited is a superset of kept", () => {
  const layout = buildFunnelCloud(fixtureData());
  for (const dot of layout.dots.filter((d) => d.kept)) assert.equal(dot.invited, true);
});

test("buildFunnelCloud's invited dot count matches data.invitedTotal", () => {
  const layout = buildFunnelCloud(fixtureData());
  assert.equal(layout.dots.filter((d) => d.invited).length, 7);
  assert.equal(layout.invitedTotal, 7);
});

test("buildFunnelCloud's invited dots per region match each region's invited quota", () => {
  const layout = buildFunnelCloud(fixtureData());
  const bayAreaInvited = layout.dots.filter((d) => d.invited && d.region === "Bay Area").length;
  const losAngelesInvited = layout.dots.filter((d) => d.invited && d.region === "Los Angeles").length;
  assert.equal(bayAreaInvited, 5);
  assert.equal(losAngelesInvited, 2);
});

test("dotTarget stage 2 defaults to lighting only kept dots, not the wider invited set", () => {
  const layout = buildFunnelCloud(fixtureData());
  const invitedNotKept = layout.dots.find((d) => d.invited && !d.kept)!;
  assert.equal(dotTarget(invitedNotKept, 2, "region", layout.clusters, 0, 0.3, 0.34).categoryKey, "__dropped");
});

test("dotTarget stage 2 with stage2Tier 'invited' lights the wider invited set, not just kept", () => {
  const layout = buildFunnelCloud(fixtureData());
  const invitedNotKept = layout.dots.find((d) => d.invited && !d.kept)!;
  const target = dotTarget(invitedNotKept, 2, "region", layout.clusters, 0, 0.3, 0.34, "orbit", "invited");
  assert.equal(target.alpha, 1);
  assert.equal(target.categoryKey, invitedNotKept.region);
});

test("dotTarget stage 2 with stage2Tier 'invited' still dims dots that are neither kept nor invited", () => {
  const layout = buildFunnelCloud(fixtureData());
  const uninvited = layout.dots.find((d) => !d.invited)!;
  const target = dotTarget(uninvited, 2, "region", layout.clusters, 0, 0.3, 0.34, "orbit", "invited");
  assert.equal(target.categoryKey, "__dropped");
  assert.equal(target.alpha, 0.1);
});

test("dotTarget stage 3 sends dropped dots off to their fall position at zero alpha", () => {
  const layout = buildFunnelCloud(fixtureData());
  const dropped = layout.dots.find((d) => !d.kept)!;
  const target = dotTarget(dropped, 3, "region", layout.clusters, 0, 0.3, 0.34);
  assert.equal(target.alpha, 0);
  assert.equal(target.x, dropped.fall[0]);
});

test("dotTarget stage 4 places kept dots on their session's orbit and colors by the requested dimension", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const target = dotTarget(kept, 4, "fieldOfWork", layout.clusters, 0, 0.3, 0.34);
  assert.equal(target.alpha, 1);
  assert.equal(target.categoryKey, kept.fieldOfWork);
  const [ox, oy] = orbitPosition(kept, layout.clusters[kept.group], 0, 0.34);
  assert.equal(target.x, ox);
  assert.equal(target.y, oy);
});

test("STAGE_COUNT accounts for all 8 stages, including the two new placeholder-cloud stages", () => {
  assert.equal(STAGE_COUNT, 8);
});

for (const stage of [5, 6]) {
  test(`dotTarget stage ${stage} matches stage 4's orbit, shifted left by RING_SHIFT_X`, () => {
    const layout = buildFunnelCloud(fixtureData());
    const kept = layout.dots.find((d) => d.kept)!;
    const stage4 = dotTarget(kept, 4, "region", layout.clusters, 1.5, 0.3, 0.34);
    const shifted = dotTarget(kept, stage, "region", layout.clusters, 1.5, 0.3, 0.34);
    assert.equal(shifted.x, stage4.x - RING_SHIFT_X);
    assert.equal(shifted.y, stage4.y);
    assert.equal(shifted.alpha, stage4.alpha);
    assert.equal(shifted.r, stage4.r);
    assert.equal(shifted.categoryKey, stage4.categoryKey);
  });

  test(`dotTarget stage ${stage} still drops non-kept dots off-canvas at zero alpha`, () => {
    const layout = buildFunnelCloud(fixtureData());
    const dropped = layout.dots.find((d) => !d.kept)!;
    const target = dotTarget(dropped, stage, "region", layout.clusters, 0, 0.3, 0.34);
    assert.equal(target.alpha, 0);
    assert.equal(target.x, dropped.fall[0]);
  });
}

test("dotTarget flags no dot as a person at stages 0, 1, 2, 4, 5 and 6 — person figures are a one-stage beat (stage 3, Phase 2 gathering), not a persistent state", () => {
  const layout = buildFunnelCloud(fixtureData());
  for (const stage of [0, 1, 2, 4, 5, 6]) {
    for (const dot of layout.dots) {
      assert.equal(dotTarget(dot, stage, "region", layout.clusters, 0, 0.3, 0.34).person, false);
    }
  }
});

test("dotTarget stage 3 flags kept dots as people and dropped dots as plain dots", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const dropped = layout.dots.find((d) => !d.kept)!;
  assert.equal(dotTarget(kept, 3, "region", layout.clusters, 0, 0.3, 0.34).person, true);
  assert.equal(dotTarget(dropped, 3, "region", layout.clusters, 0, 0.3, 0.34).person, false);
});

test("buildFunnelCloud gives every cluster a finite, positive pulse phase and period", () => {
  const layout = buildFunnelCloud(fixtureData());
  for (const cluster of layout.clusters) {
    assert.ok(Number.isFinite(cluster.pulsePhase));
    assert.ok(Number.isFinite(cluster.pulsePeriod) && cluster.pulsePeriod > 0);
  }
});

test("buildFunnelCloud gives distinct clusters distinct pulse phases, so they don't breathe in lockstep", () => {
  const layout = buildFunnelCloud(fixtureData());
  assert.ok(layout.clusters.length >= 2);
  const phases = new Set(layout.clusters.map((c) => c.pulsePhase));
  assert.equal(phases.size, layout.clusters.length);
});

test("buildFunnelCloud's pulse phase/period are deterministic across calls", () => {
  const data = fixtureData();
  const a = buildFunnelCloud(data);
  const b = buildFunnelCloud(data);
  assert.deepEqual(
    a.clusters.map((c) => c.pulsePhase),
    b.clusters.map((c) => c.pulsePhase),
  );
  assert.deepEqual(
    a.clusters.map((c) => c.pulsePeriod),
    b.clusters.map((c) => c.pulsePeriod),
  );
});

test("orbitPosition defaults to orbit mode when the mode argument is omitted", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const cluster = layout.clusters[kept.group];
  const withDefault = orbitPosition(kept, cluster, 1.2, 0.34);
  const explicitOrbit = orbitPosition(kept, cluster, 1.2, 0.34, "orbit");
  assert.deepEqual(withDefault, explicitOrbit);
});

test("orbitPosition pulse mode keeps every dot within PULSE_AMPLITUDE of its seat's home radius, across a full breathing cycle", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const cluster = layout.clusters[kept.group];
  const r = kept.orbit!.r;
  for (let step = 0; step < 20; step++) {
    const clock = (step / 20) * cluster.pulsePeriod;
    const [x, y] = orbitPosition(kept, cluster, clock, 0.34, "pulse");
    const dist = Math.hypot(x - cluster.x, y - cluster.y);
    assert.ok(
      dist >= r * (1 - PULSE_AMPLITUDE) - 1e-6 && dist <= r * (1 + PULSE_AMPLITUDE) + 1e-6,
      `distance ${dist.toFixed(2)} outside [${(r * (1 - PULSE_AMPLITUDE)).toFixed(2)}, ${(r * (1 + PULSE_AMPLITUDE)).toFixed(2)}] at clock ${clock.toFixed(2)}`,
    );
  }
});

test("orbitPosition pulse mode combines PULSE_ROTATE_FRACTION-speed rotation with radius breathing", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const cluster = layout.clusters[kept.group];
  const clock = 1.7;
  const orbitSpeed = 0.34;
  const [px, py] = orbitPosition(kept, cluster, clock, orbitSpeed, "pulse");
  const angle = kept.orbit!.a0 + clock * orbitSpeed * kept.orbit!.rate * PULSE_ROTATE_FRACTION;
  const breathe = 1 + PULSE_AMPLITUDE * Math.sin((clock / cluster.pulsePeriod) * Math.PI * 2 + cluster.pulsePhase);
  const expectedR = kept.orbit!.r * breathe;
  assert.ok(Math.abs(px - (cluster.x + Math.cos(angle) * expectedR)) < 1e-9);
  assert.ok(Math.abs(py - (cluster.y + Math.sin(angle) * expectedR)) < 1e-9);
});

test("orbitPosition pulse mode rotates slower than orbit mode for the same clock and orbit speed", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const cluster = layout.clusters[kept.group];
  const clock = 1;
  const orbitSpeed = 0.34;
  const orbitAngle = kept.orbit!.a0 + clock * orbitSpeed * kept.orbit!.rate;
  const pulseAngle = kept.orbit!.a0 + clock * orbitSpeed * kept.orbit!.rate * PULSE_ROTATE_FRACTION;
  assert.ok(PULSE_ROTATE_FRACTION > 0 && PULSE_ROTATE_FRACTION < 1);
  assert.ok(Math.abs(pulseAngle - kept.orbit!.a0) < Math.abs(orbitAngle - kept.orbit!.a0));
});

test("dotTarget defaults to orbit mode when the mode argument is omitted", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const withDefault = dotTarget(kept, 4, "region", layout.clusters, 1.2, 0.3, 0.34);
  const explicitOrbit = dotTarget(kept, 4, "region", layout.clusters, 1.2, 0.3, 0.34, "orbit");
  assert.deepEqual(withDefault, explicitOrbit);
});

test("dotTarget threads motion mode through to the ring at stage 4", () => {
  const layout = buildFunnelCloud(fixtureData());
  const kept = layout.dots.find((d) => d.kept)!;
  const clock = 2.3;
  const [ox, oy] = orbitPosition(kept, layout.clusters[kept.group], clock, 0.34, "pulse");
  const target = dotTarget(kept, 4, "region", layout.clusters, clock, 0.3, 0.34, "pulse");
  assert.equal(target.x, ox);
  assert.equal(target.y, oy);
});

for (const stage of [5, 6]) {
  test(`dotTarget threads motion mode through to the ring at stage ${stage}, still shifted by RING_SHIFT_X`, () => {
    const layout = buildFunnelCloud(fixtureData());
    const kept = layout.dots.find((d) => d.kept)!;
    const clock = 2.3;
    const [ox, oy] = orbitPosition(kept, layout.clusters[kept.group], clock, 0.34, "pulse");
    const target = dotTarget(kept, stage, "region", layout.clusters, clock, 0.3, 0.34, "pulse");
    assert.equal(target.x, ox - RING_SHIFT_X);
    assert.equal(target.y, oy);
  });
}

// Real 14-session shape from the current funnel.json export — the size
// distribution that actually ships, not a small synthetic fixture, since the
// overlap risk lives specifically in the tightest real cluster (n=8) and the
// full 103-person gather packing, neither of which the tiny fixtureData()
// above is large enough to exercise.
function realShapeData(): FunnelData {
  const sizes = [12, 12, 11, 8, 8, 7, 7, 7, 6, 5, 5, 5, 5, 5];
  const regions = [{ name: "Bay Area", surveyCount: 2702, attendCount: sizes.reduce((a, b) => a + b, 0) }];
  const fieldOfWork = [{ name: "Government", surveyCount: 2702, attendCount: sizes.reduce((a, b) => a + b, 0) }];
  return {
    phase1Total: 2702,
    regions,
    fieldOfWork,
    sessions: sizes.map((n, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      attendees: Array.from({ length: n }, () => ({ region: "Bay Area", fieldOfWork: "Government" })),
    })),
    invitedByRegion: [{ name: "Bay Area", count: sizes.reduce((a, b) => a + b, 0) }],
    invitedTotal: sizes.reduce((a, b) => a + b, 0),
  };
}

// A person glyph is a tall upright rectangle (personWidthFor x
// personHeightFor), not a circle, and it never rotates to face its seat's
// own angle on the ring — so a pair of seats can clear each other's *width*
// (straight-line distance >= personWidthFor) and still have their glyphs'
// top/bottom overlap if that pair happens to sit almost directly above/below
// each other. Checking straight-line distance against width alone (an
// earlier version of this test did exactly that) missed this — it passed
// while the real canvas showed heavily overlapping figures. The real
// invariant has to be an axis-aligned box check, and since every cluster's
// ring keeps rotating (dot.orbit.rate), a pair's (dx, dy) split sweeps
// through every orientation over one full orbit even though their straight-
// line distance never changes — so the check has to sweep `clock` too, not
// just look at one frame.
//
// Full non-overlap (dx >= w or dy >= h) isn't achievable for the largest
// real clusters without either shrinking the glyph or growing rc past the
// point where clusters start touching their own neighbors on the 14-cluster
// ring (see the cluster-gap test below) — SEAT_SPACING is tuned as the best
// trade-off, not a zero-overlap guarantee. What it does guarantee, checked
// here: no two seats are *simultaneously* more than half-hidden by each
// other on both axes, at any point in the rotation — glyphs may brush edges
// but never swallow one another.
// Stages 3-5 draw plain dots now (person glyphs are stage-2-only), but the
// ring's own spacing (RING_GAP/SEAT_SPACING, funnelCloud.ts) is left sized
// for person glyphs by choice — see its own comment — so this invariant
// still pins the geometry that matters if that choice is ever revisited.
test("at the real 14-session sizes, no two orbiting seats (stage 4 person-glyph radius) are ever more than half-hidden by each other, at any point in the orbit", () => {
  const layout = buildFunnelCloud(realShapeData());
  const w = personWidthFor(6);
  const h = personHeightFor(6);
  const kept = layout.dots.filter((d) => d.kept && d.group >= 0);
  const byCluster = new Map<number, typeof kept>();
  for (const dot of kept) {
    if (!byCluster.has(dot.group)) byCluster.set(dot.group, []);
    byCluster.get(dot.group)!.push(dot);
  }
  const ORBIT_SPEED = 0.14;
  const period = (2 * Math.PI) / ORBIT_SPEED;
  for (const [group, dots] of byCluster) {
    for (let step = 0; step < 36; step++) {
      const clock = (step / 36) * period;
      const positions = dots.map((d) => orbitPosition(d, layout.clusters[group], clock, ORBIT_SPEED));
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = Math.abs(positions[i][0] - positions[j][0]);
          const dy = Math.abs(positions[i][1] - positions[j][1]);
          const halfHidden = dx < w / 2 && dy < h / 2;
          assert.ok(
            !halfHidden,
            `cluster ${group} at clock ${clock.toFixed(2)}: seats ${i},${j} are ${dx.toFixed(1)}x${dy.toFixed(1)}px apart, more than half-hidden (w/2=${(w / 2).toFixed(1)}, h/2=${(h / 2).toFixed(1)})`,
          );
        }
      }
    }
  }
});

test("at the real 103-person gather packing (stage 3 radius), no two people's glyphs overlap at all", () => {
  const layout = buildFunnelCloud(realShapeData());
  const w = personWidthFor(7);
  const h = personHeightFor(7);
  const kept = layout.dots.filter((d) => d.kept);
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const dx = Math.abs(kept[i].gather[0] - kept[j].gather[0]);
      const dy = Math.abs(kept[i].gather[1] - kept[j].gather[1]);
      assert.ok(dx >= w || dy >= h, `gather seats ${i},${j} are ${dx.toFixed(1)}x${dy.toFixed(1)}px apart, need >= ${w.toFixed(1)}x${h.toFixed(1)}`);
    }
  }
});

test("at the real 14-session sizes, no two clusters' rings overlap", () => {
  const layout = buildFunnelCloud(realShapeData());
  const clusters = layout.clusters;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const dx = clusters[i].x - clusters[j].x;
      const dy = clusters[i].y - clusters[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      assert.ok(
        dist >= clusters[i].rc + clusters[j].rc,
        `clusters ${i},${j} centers ${dist.toFixed(1)}px apart, radii sum ${(clusters[i].rc + clusters[j].rc).toFixed(1)}`,
      );
    }
  }
});
