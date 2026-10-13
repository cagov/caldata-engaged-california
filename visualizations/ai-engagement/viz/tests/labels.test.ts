import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapLabel, computeLabelBandWidths } from "../src/lib/labels.ts";
import { computeGroupGrid } from "../src/lib/swarm.ts";

test("wrapLabel leaves a short label on one line", () => {
  assert.deepEqual(wrapLabel("Man", 100, 6), ["Man"]);
});

test("wrapLabel breaks a long label onto multiple lines without exceeding the width", () => {
  const lines = wrapLabel("Middle Eastern or North African", 90, 6);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(line.length * 6 <= 90 + 1e-9, `line "${line}" (${line.length * 6}px) exceeds 90px`);
  }
  assert.equal(lines.join(" "), "Middle Eastern or North African");
});

test("wrapLabel never drops a word, even one wider than the max width", () => {
  const lines = wrapLabel("Supercalifragilisticexpialidocious word", 40, 6);
  assert.equal(lines.join(" "), "Supercalifragilisticexpialidocious word");
});

test("computeLabelBandWidths splits the space at the midpoint between adjacent centers", () => {
  const widths = computeLabelBandWidths([50, 150, 250], 300);
  // group 0: [0, 100] -> 100px; group 1: [100, 200] -> 100px; group 2: [200, 300] -> 100px
  assert.deepEqual(widths, [100, 100, 100]);
});

test("computeLabelBandWidths is capped by the tighter side, not the sum of both sides", () => {
  const widths = computeLabelBandWidths([20, 40, 200], 300);
  // group 1's boundaries are [(20+40)/2, (40+200)/2] = [30, 120] — 10px to
  // the left of its own center (40), 80px to the right. A label centered at
  // 40 can only safely extend 10px each way before crossing into group 0's
  // territory, so its band is 2*10 = 20px, not the raw 30-to-120 span (90px).
  assert.equal(widths[1], 20);
});

test("computeLabelBandWidths gives the same answer whichever side is tighter", () => {
  // Mirror image of the case above: now it's the *right* side that's tight.
  const widths = computeLabelBandWidths([100, 260, 280], 300);
  // group 1's boundaries are [(100+260)/2, (260+280)/2] = [180, 270] — 80px
  // to the left of its center (260), 10px to the right — same 20px cap.
  assert.equal(widths[1], 20);
});

test("FIELD_OF_WORK's longest name wraps cleanly within its 6-per-row band, unlike the old 12-across-one-row layout", () => {
  // The real FIELD_OF_WORK counts and values (12 groups). At 12 groups on
  // one axis, computeLabelBandWidths gives "Logistics" only a 48px band —
  // less than the single word "Logistics" needs (60px) — so wrapLabel is
  // forced to overflow it (this is the bug the grid layout fixes). Laid out
  // 6-per-row via computeGroupGrid instead, every label — including the
  // longest, "Professional, scientific, and technical" — fits within its
  // band with no line exceeding it.
  const counts = [529, 424, 376, 349, 212, 190, 184, 165, 107, 67, 48, 27];
  const values = [
    "Other",
    "Public sector",
    "Information technology",
    "Creative industries",
    "Education",
    "Professional, scientific, and technical",
    "Healthcare",
    "I don't currently work",
    "Finance & insurance",
    "Retail",
    "Logistics",
    "I don't want to say",
  ];
  const CHAR_WIDTH = 6;
  const BAND_PADDING = 6;

  const grid = computeGroupGrid(counts, { width: 1100, r: 2.5, gap: 1 });
  assert.equal(grid.rows.length, 2, "12 groups should split into two rows of 6");

  for (const row of grid.rows) {
    const rowBandWidths = computeLabelBandWidths(
      row.map((g) => grid.x[g]),
      1100,
    );
    row.forEach((g, i) => {
      const maxWidth = Math.max(20, rowBandWidths[i] - BAND_PADDING);
      const lines = wrapLabel(values[g], maxWidth, CHAR_WIDTH);
      for (const line of lines) {
        assert.ok(
          line.length * CHAR_WIDTH <= maxWidth + 1e-9,
          `"${values[g]}": line "${line}" (${line.length * CHAR_WIDTH}px) exceeds its ${maxWidth.toFixed(0)}px band`,
        );
      }
      assert.equal(lines.join(" "), values[g]);
    });
  }
});
