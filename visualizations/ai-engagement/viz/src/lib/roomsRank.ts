/**
 * Pure sort/rank logic for the deliberation-rooms "Rank by" control, kept
 * out of DeliberationRooms.svelte so it's testable without mounting a
 * component — same convention as swarm.ts/themes.ts.
 */
import type { RoomsTheme, RoomsSubtheme, RoomsConcept, RoomsIdea } from "./roomsData.ts";

export type RankMetric = "votes" | "ideas" | "topIdeas" | "sessions" | "votesPerIdea";

export const RANK_OPTIONS: { key: RankMetric; label: string }[] = [
  { key: "votes", label: "Votes" },
  { key: "ideas", label: "Ideas" },
  { key: "topIdeas", label: "Top ideas" },
  { key: "sessions", label: "Sessions" },
  { key: "votesPerIdea", label: "Votes per idea" },
];

export type RankableEntry = RoomsTheme | RoomsSubtheme | RoomsConcept;

/**
 * "Sessions" is a genuine gap in the workbook (see the internal analysis notes): only
 * concepts carry a directly computed session count. Subthemes carry a
 * *stated* count parsed from the sheet's parenthetical text, which may be
 * null and isn't always reconciled against the concept rollup. Themes carry
 * no session count at all — summing subtheme counts would double-count any
 * session that raised more than one subtheme under the same theme, so
 * themes deliberately report null (rendered as "—") rather than a
 * fabricated aggregate.
 */
export function sessionsOf(entry: RankableEntry): number | null {
  if ("sessions" in entry) return entry.sessions;
  if ("statedSessions" in entry) return entry.statedSessions;
  return null;
}

/**
 * The theme id an entry belongs to, for theme-color lookups. Concepts and
 * subthemes carry their own `themeId`; a theme entry's "theme" is itself,
 * so it reports its own `id` — same discriminant style as `sessionsOf`.
 */
export function themeIdOf(entry: RankableEntry): string {
  return "themeId" in entry ? entry.themeId : entry.id;
}

export function votesPerIdea(entry: RankableEntry): number {
  return entry.ideas > 0 ? entry.votes / entry.ideas : 0;
}

/**
 * "Composite metric (sessions + top)" from the team's own reference sheet
 * (data/Policy ideas with votes ... - Themes, subthemes, policy
 * concepts-v2.csv) — an entry's session count plus its top-idea count.
 * Themes have no session count at all (see sessionsOf), so themes always
 * report null here rather than a partial/misleading number.
 */
export function compositeMetric(entry: RankableEntry): number | null {
  const sessions = sessionsOf(entry);
  return sessions === null ? null : sessions + entry.topIdeas;
}

export type PopularityBin = "most popular" | "popular" | "less popular" | "least popular";

/** Exactly the bins given for this ranking: 9-11 most popular, 6-7
 * popular, 3-4 less popular, 1-2 least popular. 5, 8, 0, and anything
 * above 11 fall through to `null` — real gaps in the reference sheet's own
 * scheme, not something this function should paper over by rounding into
 * a neighboring bin. */
const POPULARITY_BINS: { key: PopularityBin; min: number; max: number }[] = [
  { key: "most popular", min: 9, max: 11 },
  { key: "popular", min: 6, max: 7 },
  { key: "less popular", min: 3, max: 4 },
  { key: "least popular", min: 1, max: 2 },
];

export function popularityBinOf(composite: number | null): PopularityBin | null {
  if (composite === null) return null;
  return POPULARITY_BINS.find((b) => composite >= b.min && composite <= b.max)?.key ?? null;
}

/** Display order + range label for each bin, for rendering section headers. */
export const POPULARITY_BIN_ORDER: { key: PopularityBin; label: string; range: string }[] = [
  { key: "most popular", label: "Most popular", range: "9-11" },
  { key: "popular", label: "Popular", range: "6-7" },
  { key: "less popular", label: "Less popular", range: "3-4" },
  { key: "least popular", label: "Least popular", range: "1-2" },
];

export type EntryLevel = "theme" | "subtheme" | "concept";

/** Which of the three RankableEntry shapes this actually is — same
 * structural-discriminant style as sessionsOf/themeIdOf above, rather than
 * threading a separate `level` tag through every entry. */
export function entryLevelOf(entry: RankableEntry): EntryLevel {
  if ("subthemeId" in entry) return "concept";
  if ("themeId" in entry) return "subtheme";
  return "theme";
}

/**
 * Whether an idea's concept resolves up to the given entry — a concept
 * matches only itself, a subtheme matches any concept under it, a theme
 * matches any concept under any of its subthemes. `ideaConcept` is the
 * `RoomsConcept` an idea's `conceptId` resolves to (or `undefined` for an
 * idea s16-figjam-linkage.ts couldn't link) — an unlinked idea never
 * matches anything, which is the honest answer, not a guess.
 */
export function ideaMatchesEntry(ideaConcept: RoomsConcept | undefined, entry: RankableEntry): boolean {
  if (!ideaConcept) return false;
  switch (entryLevelOf(entry)) {
    case "concept":
      return ideaConcept.id === entry.id;
    case "subtheme":
      return ideaConcept.subthemeId === entry.id;
    case "theme":
      return ideaConcept.themeId === entry.id;
  }
}

export function rankValue(entry: RankableEntry, metric: RankMetric): number | null {
  switch (metric) {
    case "votes":
      return entry.votes;
    case "ideas":
      return entry.ideas;
    case "topIdeas":
      return entry.topIdeas;
    case "sessions":
      return sessionsOf(entry);
    case "votesPerIdea":
      return votesPerIdea(entry);
  }
}

/**
 * Sorts descending by the chosen metric. Entries with no value for that
 * metric (only themes under "sessions") sort last; ties keep their
 * original relative order (stable) rather than the sort algorithm's
 * incidental order.
 */
export function sortByRank<T extends RankableEntry>(entries: T[], metric: RankMetric): T[] {
  return entries
    .map((entry, index) => ({ entry, index, value: rankValue(entry, metric) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (b.value !== a.value) return b.value - a.value;
      return a.index - b.index;
    })
    .map((x) => x.entry);
}

/** A room's ideas, ranked by votes descending (ties stable on input order —
 * same rationale as sortByRank). */
export function sortIdeasByVotes(ideas: RoomsIdea[]): RoomsIdea[] {
  return ideas
    .map((idea, index) => ({ idea, index }))
    .sort((a, b) => (b.idea.votes !== a.idea.votes ? b.idea.votes - a.idea.votes : a.index - b.index))
    .map((x) => x.idea);
}
