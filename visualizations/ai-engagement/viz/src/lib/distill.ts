/**
 * Pure, DOM-free layered-graph builder shared by DistillFlow.svelte (the
 * vertical alluvial) and DistillTree.svelte (the radial tree/draw-in
 * animation) — both views render off this one function's output, so they
 * can never disagree about weights, filtering, or node order. Same
 * conventions as swarm.ts/rooms.ts: no iterative layout, everything closed-
 * form and unit-tested.
 *
 * Every level is normalized to sum to 1 independently (people at the Phase 1
 * end, votes/sessions at the Phase 2 end are not comparable units — see
 * an internal planning doc Global
 * Constraints). An edge therefore tapers: wSource is its share of the
 * SOURCE theme's total outgoing weight, wTarget is its share of the TARGET
 * concept's total incoming weight. The two only agree when a theme feeds
 * exactly one concept.
 */
import type { CrosswalkData, CrosswalkTheme, Strength } from "./crosswalkData.ts";
import type { RoomsData } from "./roomsData.ts";

// Duplicated from analysis/src/lib/crosswalk.ts's STRENGTH_WEIGHT on purpose
// — viz/ shares no code with analysis/ (see roomsData.ts's header comment).
// Keep the numbers in sync if either changes.
const STRENGTH_WEIGHT: Record<Strength, number> = { primary: 3, secondary: 2, tangential: 1 };

export type Scope = "all" | "policy";

export interface BuildLayersOpts {
  scope: Scope;
  /** Drop edges weaker than this floor. "tangential" keeps everything. */
  minStrength: Strength;
}

export interface DistillNode {
  id: string;
  label: string;
  kind: "theme" | "concept" | "subtheme" | "theme2";
  /** This node's share of its level, summing to 1 across the level. */
  weight: number;
  /** Absolute count backing `weight`, for labels/tooltips — a respondent
   * count for theme nodes, a vote count for concept/subtheme/theme2 nodes.
   * Never used for cross-unit geometry (see the module header). */
  raw: number;
}

export interface DistillEdge {
  conceptId: string;
  code: string;
  field: string;
  strength: Strength;
  rationale: string;
  /** This edge's share of its source theme's total outgoing weight. */
  wSource: number;
  /** This edge's share of its target concept's total incoming weight. */
  wTarget: number;
}

export interface DistillLevel {
  id: "themes1" | "concepts" | "subthemes" | "themes2";
  nodeIds: string[];
}

/** A strict-tree edge (a concept has exactly one subtheme; a subtheme has
 * exactly one theme) — unlike DistillEdge, wSource is always 1 since there
 * is nothing to split on the source side. wTarget is still a genuine share:
 * a subtheme (or theme) can have multiple children, so wTarget is that
 * child's share of the parent's total incoming weight, same taper
 * philosophy as DistillEdge, just simpler because it's a tree, not a
 * many-to-many crosswalk. */
export interface HierarchyEdge {
  fromId: string;
  toId: string;
  wSource: number;
  wTarget: number;
}

export interface DistillGraph {
  levels: DistillLevel[];
  nodesById: Map<string, DistillNode>;
  themeNodes: DistillNode[];
  edges: DistillEdge[];
  conceptEdges: HierarchyEdge[];
  subthemeEdges: HierarchyEdge[];
  /** Phase 1 themes cited by no concept, in the same scope filter as
   * themeNodes — a first-class "did not carry forward" list, not an
   * afterthought (see the spec). */
  unclaimed: DistillNode[];
}

function inScope(theme: CrosswalkTheme, scope: Scope): boolean {
  return scope === "all" ? true : theme.home === "government" || theme.home === "economy";
}

function countFor(theme: CrosswalkTheme, field: string): number {
  return (theme.counts as Record<string, number>)[field] ?? 0;
}

/**
 * Builds the full four-level graph (Phase 1 themes -> concepts -> subthemes
 * -> Phase 2 themes) for the given scope and strength floor. Ordering is
 * deterministic and crossing-minimal by construction: theme nodes are sorted
 * by (index of their strongest concept in rooms.json's own concept order,
 * then descending respondent count) rather than by an iterative solver —
 * with a fixed destination hierarchy this removes nearly all crossings for
 * free (see the spec's Task 2).
 */
export function buildLayers(crosswalk: CrosswalkData, rooms: RoomsData, opts: BuildLayersOpts): DistillGraph {
  const minWeight = STRENGTH_WEIGHT[opts.minStrength];
  const conceptIndexById = new Map(rooms.concepts.map((c, i) => [c.id, i]));

  const scopedThemes = crosswalk.themes.filter((t) => inScope(t, opts.scope));
  const scopedThemeCodes = new Set(scopedThemes.map((t) => t.code));

  const scopedEdges = crosswalk.edges.filter(
    (e) => scopedThemeCodes.has(e.code) && STRENGTH_WEIGHT[e.strength] >= minWeight,
  );

  // A theme with no surviving edge in this scope/filter combination is
  // unclaimed FOR THIS VIEW, even if some other field's edge would have
  // claimed it above the floor — the spec asks for what's on screen right
  // now, not a global fact independent of the active filter.
  const claimedCodes = new Set(scopedEdges.map((e) => e.code));
  const claimedThemes = scopedThemes.filter((t) => claimedCodes.has(t.code));
  const unclaimedThemes = scopedThemes.filter((t) => !claimedCodes.has(t.code));

  const edgesByCode = new Map<string, typeof scopedEdges>();
  for (const e of scopedEdges) {
    const list = edgesByCode.get(e.code) ?? [];
    list.push(e);
    edgesByCode.set(e.code, list);
  }

  // Each theme's "strongest concept" for ordering: highest strength first,
  // ties broken by that concept's own rooms.json order.
  function strongestConceptIndex(code: string): number {
    const edgesForCode = edgesByCode.get(code) ?? [];
    let best = { strength: 0, index: Infinity };
    for (const e of edgesForCode) {
      const idx = conceptIndexById.get(e.conceptId) ?? Infinity;
      const strength = STRENGTH_WEIGHT[e.strength];
      if (strength > best.strength || (strength === best.strength && idx < best.index)) {
        best = { strength, index: idx };
      }
    }
    return best.index;
  }

  const orderedThemes = [...claimedThemes].sort((a, b) => {
    const ai = strongestConceptIndex(a.code);
    const bi = strongestConceptIndex(b.code);
    if (ai !== bi) return ai - bi;
    return countFor(b, b.home) - countFor(a, a.home);
  });

  const nodesById = new Map<string, DistillNode>();

  // --- Phase 1 theme nodes (level "themes1"), normalized within this level ---
  const themeRaws = orderedThemes.map((t) => countFor(t, t.home));
  const themeTotal = themeRaws.reduce((a, b) => a + b, 0) || 1;
  orderedThemes.forEach((t, i) => {
    nodesById.set(t.code, { id: t.code, label: t.label, kind: "theme", raw: themeRaws[i], weight: themeRaws[i] / themeTotal });
  });

  // --- Concept nodes (level "concepts") ---
  const conceptTotal = rooms.concepts.reduce((a, c) => a + c.votes, 0) || 1;
  rooms.concepts.forEach((c) => {
    nodesById.set(c.id, { id: c.id, label: c.name, kind: "concept", raw: c.votes, weight: c.votes / conceptTotal });
  });

  // --- Subtheme nodes (level "subthemes") ---
  const subthemeTotal = rooms.subthemes.reduce((a, s) => a + s.votes, 0) || 1;
  rooms.subthemes.forEach((s) => {
    nodesById.set(s.id, { id: s.id, label: s.name, kind: "subtheme", raw: s.votes, weight: s.votes / subthemeTotal });
  });

  // --- Phase 2 theme nodes (level "themes2") ---
  const theme2Total = rooms.themes.reduce((a, t) => a + t.votes, 0) || 1;
  rooms.themes.forEach((t) => {
    nodesById.set(t.id, { id: t.id, label: t.name, kind: "theme2", raw: t.votes, weight: t.votes / theme2Total });
  });

  // --- Edge weights: taper is a per-source-theme split and a per-target-
  // concept split of the *effective* weight (count * strength), each summed
  // and normalized independently. ---
  const claimedThemeByCode = new Map(claimedThemes.map((t) => [t.code, t]));
  function effectiveWeight(e: (typeof scopedEdges)[number]): number {
    const theme = claimedThemeByCode.get(e.code);
    return theme ? countFor(theme, e.field) * STRENGTH_WEIGHT[e.strength] : 0;
  }

  const outgoingTotalByCode = new Map<string, number>();
  const incomingTotalByConcept = new Map<string, number>();
  for (const e of scopedEdges) {
    const w = effectiveWeight(e);
    outgoingTotalByCode.set(e.code, (outgoingTotalByCode.get(e.code) ?? 0) + w);
    incomingTotalByConcept.set(e.conceptId, (incomingTotalByConcept.get(e.conceptId) ?? 0) + w);
  }

  const edges: DistillEdge[] = scopedEdges.map((e) => {
    const w = effectiveWeight(e);
    const outTotal = outgoingTotalByCode.get(e.code) ?? 1;
    const inTotal = incomingTotalByConcept.get(e.conceptId) ?? 1;
    return {
      conceptId: e.conceptId,
      code: e.code,
      field: e.field,
      strength: e.strength,
      rationale: e.rationale,
      wSource: outTotal > 0 ? w / outTotal : 0,
      wTarget: inTotal > 0 ? w / inTotal : 0,
    };
  });

  const unclaimedNodes: DistillNode[] = unclaimedThemes.map((t) => ({
    id: t.code,
    label: t.label,
    kind: "theme",
    raw: countFor(t, t.home),
    weight: 0, // unclaimed nodes render in their own detached channel, not this level's proportional share
  }));

  // Concept -> subtheme edges. Each concept belongs to exactly one
  // subtheme (wSource always 1); wTarget is the concept's share of its
  // subtheme's total incoming votes.
  const conceptVotesBySubtheme = new Map<string, number>();
  for (const c of rooms.concepts) {
    conceptVotesBySubtheme.set(c.subthemeId, (conceptVotesBySubtheme.get(c.subthemeId) ?? 0) + c.votes);
  }
  const conceptEdges: HierarchyEdge[] = rooms.concepts.map((c) => {
    const subthemeTotal = conceptVotesBySubtheme.get(c.subthemeId) ?? 0;
    return { fromId: c.id, toId: c.subthemeId, wSource: 1, wTarget: subthemeTotal > 0 ? c.votes / subthemeTotal : 0 };
  });

  // Subtheme -> theme edges, same shape.
  const subthemeVotesByTheme = new Map<string, number>();
  for (const s of rooms.subthemes) {
    subthemeVotesByTheme.set(s.themeId, (subthemeVotesByTheme.get(s.themeId) ?? 0) + s.votes);
  }
  const subthemeEdges: HierarchyEdge[] = rooms.subthemes.map((s) => {
    const themeTotal = subthemeVotesByTheme.get(s.themeId) ?? 0;
    return { fromId: s.id, toId: s.themeId, wSource: 1, wTarget: themeTotal > 0 ? s.votes / themeTotal : 0 };
  });

  return {
    levels: [
      { id: "themes1", nodeIds: orderedThemes.map((t) => t.code) },
      { id: "concepts", nodeIds: rooms.concepts.map((c) => c.id) },
      { id: "subthemes", nodeIds: rooms.subthemes.map((s) => s.id) },
      { id: "themes2", nodeIds: rooms.themes.map((t) => t.id) },
    ],
    nodesById,
    themeNodes: orderedThemes.map((t) => nodesById.get(t.code)!),
    edges,
    conceptEdges,
    subthemeEdges,
    unclaimed: unclaimedNodes,
  };
}
