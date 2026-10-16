/* ideas-scroll-layout.js — pure logic for the scroll-story variant of the
 * ideas cloud: sizing, word-record building, long-tail sampling, ring
 * seeding (beat 1's "words start around the copy" arrival), and edge
 * feathering. No DOM, no canvas — same split as funnel-layout.js /
 * FunnelLayout in handoff/participant-funnel/, so this file is testable
 * under plain Node and ideas-scroll.js only draws and animates what it
 * computes.
 *
 * window.IdeasScrollLayout({ rand, WL }) -> {
 *   titleCaseRecords, sampleTailKept, ringHomePositions, edgeFeatherAlpha,
 *   buildWordRecord, phase1FontSize, phase2FontSize, ease, lerp, clamp01,
 * }
 *
 * `rand` is a caller-supplied deterministic RNG (mulberry32); `WL` is a
 * WhirlLayout instance (whirl-layout.js) — this module calls its
 * textWidth/wrapTwoLines/titleCase/lineHeightFactor, it doesn't reimplement
 * them.
 */
(function () {
  "use strict";

  window.IdeasScrollLayout = function IdeasScrollLayout({ rand, WL }) {
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // easeInOutCubic
    const smoothstep = (edge0, edge1, x) => {
      const t = clamp01((x - edge0) / (edge1 - edge0));
      return t * t * (3 - 2 * t);
    };

    // ---- sizing — same formulas as the report's own shipped module (its
    // minified ai-impact-report.js), so this variant's word sizes read as
    // the same cloud, not a re-tuned one. ------------------------------------
    function phase1FontSize(count, maxCount) {
      return 11 + 26 * Math.pow(count / maxCount, 0.6);
    }
    function phase2FontSize(votes, maxVotes, finaleScale) {
      return (17 + 29 * Math.sqrt(votes / maxVotes)) * (finaleScale || 1.3);
    }

    // ---- word records ---------------------------------------------------------
    /** Builds one word record: title-cased label, wrapped lines, measured box,
     * and a size-dependent lineHeight (this fork's PATCH 10 in
     * d3-cloud-multiline.js, and the matching branch in WL.drawWord). `weight`
     * is the font weight used for both wrapping/measuring and drawing (400 for
     * the poll cloud, 700 for the discussion finale — matches the two sketches). */
    function buildWordRecord(raw, i, { fontSize, weight, maxLineWidth, maxLineHeightHint }) {
      const label = WL.titleCase(raw.label);
      const lines = WL.wrapTwoLines(label, fontSize, weight, maxLineWidth);
      const w = Math.max(...lines.map((l) => WL.textWidth(l, fontSize, weight))) + (weight >= 700 ? 8 : 6);
      const lineHeight = fontSize * WL.lineHeightFactor(fontSize);
      const h = lines.length * lineHeight + (maxLineHeightHint || 4);
      return {
        i,
        label,
        rawLabel: raw.label,
        subtheme: raw.subtheme,
        fontSize,
        lines,
        w,
        h,
        lineHeight, // read by d3-cloud-multiline.js's cloudSprite() as d.lineHeight (PATCH 10)
      };
    }

    // ---- long-tail sampling -----------------------------------------------------
    // Hides a fixed fraction of the count===1 poll ideas — a visual density
    // choice on already-public data (the report's own /public/data JSON), not
    // a privacy control; the caller states the dropped count in the caption.
    // Deterministic: a Fisher-Yates shuffle of just the count-1 indices, using
    // the caller's seeded `rand`, so the same seed always drops the same set.
    function sampleTailKept(pollItems, tailDrop) {
      const ones = [];
      pollItems.forEach((p, idx) => {
        if (p.count === 1) ones.push(idx);
      });
      // Fisher-Yates over the count-1 indices only; everything else is untouched.
      for (let i = ones.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [ones[i], ones[j]] = [ones[j], ones[i]];
      }
      const dropCount = Math.round(ones.length * tailDrop);
      const dropped = new Set(ones.slice(0, dropCount));
      const kept = pollItems.filter((_, idx) => !dropped.has(idx));
      return { kept, droppedCount: dropped.size, totalOnes: ones.length };
    }

    // ---- ring seeding (beat 1 arrival) -------------------------------------------
    // Ported composition, not the LA fires page's code: that page scatters
    // fixed illustrations around a FIXED-position hero column at page load.
    // Here the same idea — words start on an ellipse around the copy, not in
    // a central blob — has to work for however many words are seeded and
    // resize with the copy's own measured rect, so this reimplements the
    // ellipse-around-centred-text geometry rather than porting statements.
    //
    // Ellipse radii follow the LA fires ring's own proportions (rx = 0.40 of
    // field width, ry = 0.40 of field height); `plateRect` (the measured
    // .narrative-copy box) sets an inner exclusion radius so no word starts
    // under the copy plate. Heavier words (larger fontSize) seed nearer that
    // inner edge — literally the shortest flight to the packed cloud's
    // typically-central big words — lighter words spread toward the outer
    // edge, with per-word jitter so the ring doesn't read as a lattice.
    function ringHomePositions(words, field, plateRect) {
      const { width: W, height: H } = field;
      const CX = W / 2,
        CY = H / 2;
      const RX = W * 0.4,
        RY = H * 0.4;
      const plateHalfW = plateRect ? plateRect.width / 2 : 0;
      const plateHalfH = plateRect ? plateRect.height / 2 : 0;
      const MARGIN = 36;
      // The ring's innermost band is a CIRCLE of radius minR (both axis
      // fractions reduce to minR/RX and minR/RY respectively, which by
      // construction put the same point at distance minR regardless of
      // angle at bandFrac 0 — see the two lerps below). That guarantee only
      // holds while minR stays under BOTH semi-axes: capping each fraction
      // independently at 1 (clamp01) would silently let whichever axis is
      // shorter (typically RY, when the plate is tall relative to the
      // field) collapse to that axis's full extent — i.e. words seeded AT
      // the plate's edge on that axis, no clearance at all. So clamp minR
      // itself against the shorter semi-axis first; on a field so small (or
      // a plate so large) that even that clamp bites, the ring tightens
      // toward the plate rather than guaranteeing full clearance — a soft
      // floor, not a hard one.
      const ringOuterR = Math.min(RX, RY);
      const minR = Math.min(Math.max(60, Math.hypot(plateHalfW, plateHalfH) * 1.15 + MARGIN), ringOuterR * 0.92);
      const minRxFrac = minR / RX;
      const minRyFrac = minR / RY;
      const GOLDEN_ANGLE = 2.399963229728653;
      const maxFontSize = Math.max(...words.map((w) => w.fontSize), 1);
      return words.map((w, i) => {
        const angle = i * GOLDEN_ANGLE + rand() * 0.3;
        const weight = w.fontSize / maxFontSize; // 1 = heaviest
        const ringT = clamp01(1 - weight); // 0 = heaviest -> inner edge
        const jitter = rand() * 0.22;
        const bandFrac = clamp01(ringT * 0.5 + jitter);
        const rxFrac = lerp(minRxFrac, 1, bandFrac);
        const ryFrac = lerp(minRyFrac, 1, bandFrac);
        return [CX + Math.cos(angle) * RX * rxFrac, CY + Math.sin(angle) * RY * ryFrac];
      });
    }

    // ---- edge feather (phase-1 cloud only) ---------------------------------------
    // `field` is the OVERSIZED layout field (EDGE_BLEED x the visible one) that
    // d3-cloud actually places words on; `visible` is the un-bled field the
    // canvas is fit to. Both are centred on the same point. Alpha is 1 inside
    // FEATHER_INNER of the visible half-extent, eased down to 0 by the time a
    // word's distance reaches the visible edge scaled up to where the bleed
    // field ends — so the cloud spills past the visible frame and dissolves,
    // rather than stopping at a hard rectangle. Never applied to the 27
    // discussion ideas — those stay fully legible and inside the field.
    const FEATHER_INNER = 0.78;
    function edgeFeatherAlpha(x, y, visible, field) {
      const cx = field.width / 2,
        cy = field.height / 2;
      const halfW = visible.width / 2,
        halfH = visible.height / 2;
      const r = Math.hypot((x - cx) / halfW, (y - cy) / halfH); // 1.0 == the visible edge
      const outer = field.width / visible.width; // == EDGE_BLEED; where alpha reaches 0
      if (r <= FEATHER_INNER) return 1;
      const t = smoothstep(outer, FEATHER_INNER, r); // 1 at FEATHER_INNER, 0 at outer
      return clamp01(t);
    }

    return {
      clamp01,
      lerp,
      ease,
      phase1FontSize,
      phase2FontSize,
      buildWordRecord,
      sampleTailKept,
      ringHomePositions,
      edgeFeatherAlpha,
      FEATHER_INNER,
    };
  };
})();
