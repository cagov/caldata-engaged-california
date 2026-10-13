/**
 * Pure axis-label layout: word-wrapping long category names within the
 * space actually available around their group, so adjacent labels (e.g.
 * RACE_ETHNICITY_CATEGORY's "Middle Eastern or North African" next to a
 * narrow, low-n blob) never run into each other.
 */

/**
 * Greedily wrap `text` into lines no wider than `maxWidthPx`, estimating
 * each line's width as `line.length * charWidthPx` (no DOM measurement
 * available in pure/testable code — a monospace-ish estimate is close
 * enough for axis labels and never under-estimates badly enough to
 * overflow the allotted band in practice). A single word wider than the
 * limit is never split — it gets its own line rather than being dropped.
 */
export function wrapLabel(text: string, maxWidthPx: number, charWidthPx: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length * charWidthPx > maxWidthPx) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The horizontal space available to each group's label, drawn centered
 * (text-anchor="middle") on its own group's x: twice the *smaller* of the
 * distance to the midpoint on its left vs. its right, not the sum of both.
 * A centered label extends equally in both directions from its own x, so
 * it's only as safe as its tighter side — using the sum instead would let
 * a label bleed into a neighbor whenever that neighbor's blob is small
 * enough to pull the shared midpoint close on one side while the other
 * side stays wide open (e.g. a small group sitting next to a much larger
 * one, both squeezed next to a tiny one on the small group's far side).
 * Edge groups get the midpoint on their one neighboring side and the chart
 * edge on the other.
 */
export function computeLabelBandWidths(centers: number[], chartWidth: number): number[] {
  return centers.map((center, i) => {
    const left = i === 0 ? 0 : (centers[i - 1] + center) / 2;
    const right = i === centers.length - 1 ? chartWidth : (center + centers[i + 1]) / 2;
    return 2 * Math.min(center - left, right - center);
  });
}
