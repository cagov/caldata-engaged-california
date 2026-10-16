/**
 * Deterministic linkage between rooms-view's ideas and the current (up to
 * date) 29-concept codebook, sourced from a frozen snapshot of the team's
 * FigJam sticky-note board (config/figjam-idea-concept-map.json — see
 * s16-figjam-linkage.ts). The board organizes real sticky notes spatially
 * under concept-label headers, arranged in columns (one column per
 * subtheme) within each theme section; this module reconstructs that
 * grouping from raw (x, y) coordinates, then matches each sticky's text
 * against the existing roomIdeas.json idea text to attach a concrete idea
 * id.
 *
 * Purely geometric/textual — no LLM, no network call, no classification
 * judgment call. Validated against the real board: column+y-band
 * assignment reproduces each concept label's own stated "N policy ideas"
 * count almost exactly (24/29 exact, remainder off by 1-2 at a column's
 * y-boundary); sticky-text matching resolves ~89% of stickies to a unique
 * idea id with zero ambiguous collisions. The rest stay unlinked and
 * visible (see FigjamLinkageResult.unmatchedStickies), never guessed at.
 */

export interface FigjamLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sectionId: string;
  level: "concept" | "subtheme";
}

export interface FigjamSticky {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  sectionId: string;
}

export interface FigjamExtract {
  labels: FigjamLabel[];
  stickies: FigjamSticky[];
}

/** One column of concept labels within a section, sorted by y ascending. */
export interface LabelColumn {
  xRepr: number;
  labels: FigjamLabel[];
}

// Labels within ~500px of a column's running-mean x join that column,
// rather than starting a new one — tuned against the real board, where a
// section's columns sit ~2700-2900px apart but a single column's labels
// drift by only tens of px from each other.
const COLUMN_MERGE_THRESHOLD = 500;

/**
 * Groups each section's concept labels into vertical columns by x-proximity
 * (merging any label within COLUMN_MERGE_THRESHOLD of a column's running
 * mean x into that column), then sorts each column's labels by y ascending.
 * Returns one column list per sectionId, since a sticky's column search
 * (assignStickyToLabel) must never cross into a different section's
 * columns.
 */
export function clusterLabelsIntoColumns(labels: FigjamLabel[]): Map<string, LabelColumn[]> {
  const bySection = new Map<string, FigjamLabel[]>();
  for (const l of labels) {
    if (!bySection.has(l.sectionId)) bySection.set(l.sectionId, []);
    bySection.get(l.sectionId)!.push(l);
  }

  const result = new Map<string, LabelColumn[]>();
  for (const [sectionId, labs] of bySection) {
    const sorted = [...labs].sort((a, b) => a.x - b.x);
    const columns: LabelColumn[] = [];
    for (const l of sorted) {
      const col = columns.find((c) => Math.abs(c.xRepr - l.x) < COLUMN_MERGE_THRESHOLD);
      if (col) {
        col.labels.push(l);
        col.xRepr = col.labels.reduce((sum, x) => sum + x.x, 0) / col.labels.length;
      } else {
        columns.push({ xRepr: l.x, labels: [l] });
      }
    }
    for (const col of columns) col.labels.sort((a, b) => a.y - b.y);
    result.set(sectionId, columns);
  }
  return result;
}

/**
 * Assigns a sticky to the concept label directly above it in the same
 * column: find the nearest column (by x) within the sticky's own section,
 * then the label with the largest y at or before the sticky's own center y
 * (falling back to that column's first/topmost label if the sticky sits
 * above every label in its column — an edge case, not expected to matter
 * for a real board where every sticky sits below some header).
 */
export function assignStickyToLabel(
  sticky: FigjamSticky,
  columnsBySection: Map<string, LabelColumn[]>,
): FigjamLabel | null {
  const columns = columnsBySection.get(sticky.sectionId);
  if (!columns || columns.length === 0) return null;

  const cx = sticky.x + sticky.width / 2;
  const cy = sticky.y + sticky.height / 2;

  let bestCol = columns[0];
  let bestDist = Math.abs(bestCol.xRepr - cx);
  for (const c of columns) {
    const dist = Math.abs(c.xRepr - cx);
    if (dist < bestDist) {
      bestDist = dist;
      bestCol = c;
    }
  }

  const candidates = bestCol.labels.filter((l) => l.y <= cy);
  return candidates.length > 0 ? candidates[candidates.length - 1] : bestCol.labels[0];
}

/**
 * A concept label's own display text carries its stated stats suffix
 * (" (N sessions; N votes; N policy ideas; N top ideas)") — this strips
 * that back off to the bare concept name, e.g. "Control how AI works".
 */
export function labelConceptName(labelText: string): string {
  return labelText.replace(/\s*\(\d+\s*sessions?.*\)\s*$/, "").trim();
}

/**
 * Lowercases, strips a trailing "- N" or "(N)" vote-count suffix, and
 * collapses punctuation/whitespace — the same normalization
 * s16-figjam-linkage.ts's sibling deterministic joins use, so the same
 * idea typed/exported twice with different vote-annotation styles still
 * compares equal.
 */
export function normalizeIdeaText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*(?:-\s*\d+|\(\d+\))\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** normalizedText -> every idea id whose roomIdeas.json text normalizes to it. */
export function buildIdeaTextIndex(roomIdeaText: Record<string, string>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [id, text] of Object.entries(roomIdeaText)) {
    const norm = normalizeIdeaText(text);
    if (!index.has(norm)) index.set(norm, []);
    index.get(norm)!.push(id);
  }
  return index;
}

export interface TextMatchResult {
  matchedIdeaId: string | null;
  /** True when the sticky's normalized text collides with more than one
   * idea id — a real (rare) possibility since board content and
   * roomIdeas.json are independently authored; callers must treat this as
   * unresolved, never guess which one. */
  ambiguous: boolean;
}

export function matchStickyToIdeaId(stickyText: string, index: Map<string, string[]>): TextMatchResult {
  const ids = index.get(normalizeIdeaText(stickyText));
  if (!ids) return { matchedIdeaId: null, ambiguous: false };
  if (ids.length > 1) return { matchedIdeaId: null, ambiguous: true };
  return { matchedIdeaId: ids[0], ambiguous: false };
}

export interface LinkedIdea {
  ideaId: string;
  conceptName: string;
}

export interface UnmatchedSticky {
  stickyId: string;
  text: string;
  reason: "no-label" | "no-text-match" | "ambiguous-text-match";
}

export interface FigjamLinkageResult {
  linked: LinkedIdea[];
  unmatchedStickies: UnmatchedSticky[];
}

/**
 * The full pipeline: spatially assign every sticky to its concept label,
 * then resolve that sticky to a concrete rooms.json idea id by text match.
 * A sticky only ever ends up in `linked` when both steps succeed
 * unambiguously — everything else is reported in `unmatchedStickies` with
 * why, for a human to see, not silently dropped.
 */
export function linkIdeasViaFigjam(extract: FigjamExtract, roomIdeaText: Record<string, string>): FigjamLinkageResult {
  const conceptLabels = extract.labels.filter((l) => l.level === "concept");
  const columnsBySection = clusterLabelsIntoColumns(conceptLabels);
  const textIndex = buildIdeaTextIndex(roomIdeaText);

  const linked: LinkedIdea[] = [];
  const unmatchedStickies: UnmatchedSticky[] = [];

  for (const sticky of extract.stickies) {
    const label = assignStickyToLabel(sticky, columnsBySection);
    if (!label) {
      unmatchedStickies.push({ stickyId: sticky.id, text: sticky.text, reason: "no-label" });
      continue;
    }

    const match = matchStickyToIdeaId(sticky.text, textIndex);
    if (match.ambiguous) {
      unmatchedStickies.push({ stickyId: sticky.id, text: sticky.text, reason: "ambiguous-text-match" });
      continue;
    }
    if (!match.matchedIdeaId) {
      unmatchedStickies.push({ stickyId: sticky.id, text: sticky.text, reason: "no-text-match" });
      continue;
    }

    linked.push({ ideaId: match.matchedIdeaId, conceptName: labelConceptName(label.text) });
  }

  return { linked, unmatchedStickies };
}
