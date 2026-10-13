/**
 * Pure data-shaping for the funnel-cloud prototype's 5th stage,
 * "Deliberative moments" — the 29 rooms.json policy concepts, grouped into
 * the same four popularity bins DeliberationRoomsByPopularity.svelte uses,
 * joined against funnelCloud.ts's clusters so a concept can be hovered to
 * highlight the real conversations that raised it.
 *
 * One of only two files in viz/ that import both funnelCloud.ts and
 * roomsData.ts — everywhere else, the two datasets stay unaware of each
 * other (see funnelData.ts's and roomsData.ts's own header comments). This
 * module and conversationPeek.ts (the funnel cloud's stage-4 "behind the
 * curtain" data) are the only places they're allowed to meet, and both stay
 * DOM-free so they're testable without mounting a component, same
 * convention as roomsRank.ts/orbitAnchor.ts. joinBySessionNumber below is
 * exported so conversationPeek.ts reuses this exact date join rather than
 * re-deriving it.
 */
import type { Cluster } from "./funnelCloud.ts";
import type { RoomsData, RoomsConcept, RoomsIdea } from "./roomsData.ts";
import type { ConceptInsight } from "./insightsData.ts";
import {
  compositeMetric,
  popularityBinOf,
  ideaMatchesEntry,
  sortIdeasByVotes,
  POPULARITY_BIN_ORDER,
  type PopularityBin,
} from "./roomsRank.ts";

/**
 * Excel PERCENTRANK.INC: a value's rank among `values`, as a fraction of
 * [0, 1], where a value equal to the minimum scores 0 and the maximum
 * scores 1. Ties resolve to the *first* (lowest) matching sorted index —
 * exactly what reproduces the reference sheet's own
 * "Composite metric order (percentrank session% + percentrank top)" column
 * to 4 decimal places (verified against
 * data/Copy of Policy ideas with votes ... .csv).
 *
 * `v` is expected to be a member of `values` (every call site here measures
 * a concept against the full set it's drawn from) — for a `v` outside that
 * set, this interpolates between the two bracketing sorted values, clamping
 * to 0/1 past either end rather than returning Excel's #N/A, so a caller
 * never has to guard a NaN.
 */
export function percentRankInc(values: number[], v: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= 1) return 0;

  const exact = sorted.indexOf(v);
  if (exact >= 0) return exact / (n - 1);

  if (v < sorted[0]) return 0;
  if (v > sorted[n - 1]) return 1;

  let i = 0;
  while (i < n && sorted[i] < v) i++;
  const x0 = sorted[i - 1];
  const x1 = sorted[i];
  return (i - 1 + (v - x0) / (x1 - x0)) / (n - 1);
}

/**
 * The reference sheet's secondary sort key, per concept id — mean of the
 * concept's own percentile rank on `sessions` and on `topIdeas` among all
 * concepts. `sessions%` in the sheet is `sessions / 14`, a constant
 * denominator, so ranking on it is identical to ranking on the raw session
 * count — the division is skipped here.
 */
export function compositeOrder(concepts: RoomsConcept[]): Map<string, number> {
  const sessionValues = concepts.map((c) => c.sessions);
  const topValues = concepts.map((c) => c.topIdeas);
  return new Map(
    concepts.map((c) => [c.id, (percentRankInc(sessionValues, c.sessions) + percentRankInc(topValues, c.topIdeas)) / 2]),
  );
}

export interface MomentSession {
  clusterIndex: number;
  sessionNumber: number;
  date: string;
  linkedIdeas: number;
  votes: number;
  /** How many of this concept's ideas in this session ranked in the top
   * third by votes among *all* of that session's own ideas — see
   * topThirdIdeaIdsBySession below. Not a workbook column; computed
   * directly from real per-idea vote counts, so it can be 0 even for a
   * session with real linkedIdeas/votes above. */
  topVotedLinkedIdeas: number;
}

export interface MomentConcept {
  id: string;
  name: string;
  themeId: string;
  composite: number;
  order: number;
  /** rooms.json's own concept-level session count — the workbook figure a
   * row displays. */
  statedSessions: number;
  /** Distinct sessions actually reachable via idea.conceptId linkage — what
   * the hover highlight can light up. Linkage is ~85% coverage (see
   * roomsData.ts's meta.linkageCoverage), so this is <= statedSessions for
   * most concepts; never assume the two agree. */
  derivedSessions: number;
  votes: number;
  ideas: number;
  topIdeas: number;
  /** Sessions with >=1 linked idea for this concept, sorted by votes
   * descending — the hover highlight's contributing set. */
  contributing: MomentSession[];
}

export interface MomentGroup {
  key: PopularityBin;
  label: string;
  range: string;
  concepts: MomentConcept[];
}

export interface SessionJoin {
  clusterIndex: number;
  date: string;
}

/**
 * funnel.json's clusters carry only a session `date` (see funnelCloud.ts);
 * rooms.json's sessions carry `number` and `date`. All 14 dates match 1:1
 * with identical attendee counts (verified against the live artifacts) —
 * this is the one join point between the two datasets. Exported for
 * conversationPeek.ts, which needs the same session-number lookup but has
 * no concept-linkage reason of its own to duplicate this join.
 */
export function joinBySessionNumber(rooms: RoomsData, clusters: Cluster[]): Map<number, SessionJoin> {
  const clusterIndexByDate = new Map(clusters.map((cl, i) => [cl.date, i]));
  const out = new Map<number, SessionJoin>();
  for (const session of rooms.sessions) {
    const clusterIndex = clusterIndexByDate.get(session.date);
    if (clusterIndex !== undefined) out.set(session.number, { clusterIndex, date: session.date });
  }
  return out;
}

/**
 * Every idea id that ranked in the top third by votes among its own
 * session's ideas — ties broken by sortIdeasByVotes' own stability (the
 * sheet's original row order), same tie rule the rest of this codebase
 * uses. Not a workbook column: the workbook's per-concept "Top ideas" count
 * (RoomsConcept.topIdeas, used by compositeMetric/compositeOrder above) is
 * a separate, aggregate figure from the sheet itself — this is computed
 * fresh from every idea's own real vote count against the other ideas in
 * the same session, which is the only per-idea-per-session granularity
 * rooms.json actually has.
 */
function topThirdIdeaIdsBySession(ideas: RoomsIdea[]): Set<string> {
  const bySession = new Map<number, RoomsIdea[]>();
  for (const idea of ideas) {
    const list = bySession.get(idea.sessionNumber) ?? [];
    list.push(idea);
    bySession.set(idea.sessionNumber, list);
  }

  const topIds = new Set<string>();
  for (const sessionIdeas of bySession.values()) {
    const ranked = sortIdeasByVotes(sessionIdeas);
    const topCount = Math.ceil(ranked.length / 3);
    for (const idea of ranked.slice(0, topCount)) topIds.add(idea.id);
  }
  return topIds;
}

function contributingSessionsFor(
  concept: RoomsConcept,
  ideas: RoomsIdea[],
  conceptById: Map<string, RoomsConcept>,
  joinOf: Map<number, SessionJoin>,
  topThirdIdeaIds: Set<string>,
): MomentSession[] {
  const bySession = new Map<number, { linkedIdeas: number; votes: number; topVotedLinkedIdeas: number }>();
  for (const idea of ideas) {
    const ideaConcept = idea.conceptId ? conceptById.get(idea.conceptId) : undefined;
    if (!ideaMatchesEntry(ideaConcept, concept)) continue;
    const entry = bySession.get(idea.sessionNumber) ?? { linkedIdeas: 0, votes: 0, topVotedLinkedIdeas: 0 };
    entry.linkedIdeas += 1;
    entry.votes += idea.votes;
    if (topThirdIdeaIds.has(idea.id)) entry.topVotedLinkedIdeas += 1;
    bySession.set(idea.sessionNumber, entry);
  }

  const sessions: MomentSession[] = [];
  for (const [sessionNumber, { linkedIdeas, votes, topVotedLinkedIdeas }] of bySession) {
    const join = joinOf.get(sessionNumber);
    if (!join) continue; // no cluster for this session's date — shouldn't happen, but never fabricate one
    sessions.push({ clusterIndex: join.clusterIndex, sessionNumber, date: join.date, linkedIdeas, votes, topVotedLinkedIdeas });
  }
  return sessions.sort((a, b) => b.votes - a.votes || a.sessionNumber - b.sessionNumber);
}

/**
 * Groups every rooms.json concept into the same four popularity bins
 * DeliberationRoomsByPopularity.svelte uses (composite = sessions +
 * topIdeas), ordered within each bin by the reference sheet's own secondary
 * key (compositeOrder, descending), ties alphabetical by name — the sheet's
 * own "alphabetize for ties once plain language is done" instruction.
 *
 * Every one of the 29 real concepts lands in a bin today (verified: sizes
 * 9/6/10/4, zero in the composite's real gaps of 0/5/8) — same
 * silent-drop-if-ungrouped behavior as popularityGroups in
 * DeliberationRoomsByPopularity.svelte for a concept whose composite falls
 * in a gap, since there's no invented 5th bin to put it in.
 */
export function buildMomentGroups(rooms: RoomsData, clusters: Cluster[]): MomentGroup[] {
  const conceptById = new Map(rooms.concepts.map((c) => [c.id, c]));
  const joinOf = joinBySessionNumber(rooms, clusters);
  const order = compositeOrder(rooms.concepts);
  const topThirdIdeaIds = topThirdIdeaIdsBySession(rooms.ideas);

  const momentConcepts: MomentConcept[] = rooms.concepts.map((concept) => {
    const contributing = contributingSessionsFor(concept, rooms.ideas, conceptById, joinOf, topThirdIdeaIds);
    return {
      id: concept.id,
      name: concept.name,
      themeId: concept.themeId,
      composite: compositeMetric(concept) ?? 0,
      order: order.get(concept.id) ?? 0,
      statedSessions: concept.sessions,
      derivedSessions: contributing.length,
      votes: concept.votes,
      ideas: concept.ideas,
      topIdeas: concept.topIdeas,
      contributing,
    };
  });

  return POPULARITY_BIN_ORDER.map(({ key, label, range }) => ({
    key,
    label,
    range,
    concepts: momentConcepts
      .filter((c) => popularityBinOf(c.composite) === key)
      .sort((a, b) => b.order - a.order || a.name.localeCompare(b.name)),
  }));
}

/** "finance worker" for Financial, etc. — kept generic ("attendee") for the
 * three field-of-work values that aren't a "worker" claim: not currently
 * working, refused, or not stated. Any future/unmapped value also falls
 * back to "attendee" rather than guessing a phrase. */
const FIELD_OF_WORK_PHRASE: Record<string, string> = {
  Government: "government worker",
  Other: "worker",
  "Information technology": "IT worker",
  Creative: "creative worker",
  Education: "education worker",
  "Professional services": "professional services worker",
  Healthcare: "healthcare worker",
  Financial: "finance worker",
  "Goods producing and harvesting": "goods and harvesting worker",
  Retail: "retail worker",
  Logistics: "logistics worker",
  Hospitality: "hospitality worker",
};

/** "in the Bay Area" for Bay Area, etc. A region absent from this map (the
 * refusal/not-stated sentinels, or anything unmapped) omits the clause
 * entirely rather than guessing — attributionFor below treats a missing
 * entry as "no region to report." */
const REGION_PHRASE: Record<string, string> = {
  "Los Angeles": "in Los Angeles",
  "Bay Area": "in the Bay Area",
  "Southern California": "in Southern California",
  "Sacramento Valley / Sierra Foothills": "in the Sacramento Valley / Sierra Foothills",
  "Central Valley": "in the Central Valley",
  "Far North / North Coast": "in the Far North / North Coast",
  "Central Coast": "in the Central Coast",
  "Sierra Region": "in the Sierra Region",
};

export interface MomentAttendee {
  region: string;
  fieldOfWork: string;
}

/**
 * Picks a real attendee of the given session (deterministically, by `seed`
 * — so a byline never reshuffles on re-render) and describes them as
 * "<field-of-work phrase> <region phrase>", e.g. "finance worker in the Bay
 * Area". This attendee is real; the quote text placed next to their byline
 * is not — see PLACEHOLDER_QUOTES below. Never claims a region for a
 * refusal/not-stated attendee.
 */
/** Capitalizes just the first character — every caller of attributionFor
 * shows its result as a standalone byline/title (a quote's attribution
 * line, not a clause inside a larger sentence), so it reads as a proper
 * caption rather than mid-sentence lowercase. */
function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function attributionFor(attendees: MomentAttendee[], seed: number): string {
  if (attendees.length === 0) return "An attendee";
  const index = ((seed % attendees.length) + attendees.length) % attendees.length;
  const attendee = attendees[index];
  const work = FIELD_OF_WORK_PHRASE[attendee.fieldOfWork] ?? "attendee";
  const region = REGION_PHRASE[attendee.region];
  return capitalizeFirst(region ? `${work} ${region}` : work);
}

/** Obviously-placeholder quote text — README data rule 2 forbids real
 * response text in git, so this stands in for it rather than fetching
 * roomIdeas.json. Rotated deterministically by the same `seed` convention
 * as attributionFor, so a given card's quote never reshuffles either. */
export const PLACEHOLDER_QUOTES: string[] = [
  "Placeholder quote text standing in for a real deliberation moment from this conversation.",
  "Placeholder — a second illustrative moment from this conversation would appear here.",
  "Placeholder — this is where a supporting quote from the session would go.",
];

export function placeholderQuoteFor(seed: number): string {
  const index = ((seed % PLACEHOLDER_QUOTES.length) + PLACEHOLDER_QUOTES.length) % PLACEHOLDER_QUOTES.length;
  return PLACEHOLDER_QUOTES[index];
}

/** Same shape whether a concept's copy comes from a real insight or a
 * placeholder — `isPlaceholder` is the only thing a caller needs to decide
 * whether to render the "placeholder text" tag next to it. */
export interface CardQuote {
  text: string;
  byline: string;
  isPlaceholder: boolean;
}

/** insights.json (see insightsData.ts) supplies a plain-language rewrite of
 * a handful of concept names; everything else keeps rooms.json's own name. */
export function displayNameFor(concept: MomentConcept, insight?: ConceptInsight): string {
  return insight?.name ?? concept.name;
}

/**
 * A concept with real insight quotes shows those, verbatim, with their own
 * byline — insights.json doesn't say which session a quote came from, so
 * pairing one with a session's attendee list would fabricate provenance the
 * source doc never claimed. Every other concept keeps today's placeholder
 * path: up to two of its contributing sessions, each a rotating
 * PLACEHOLDER_QUOTES entry attributed to a real (but unrelated) attendee of
 * that session.
 */
export function cardQuotesFor(
  concept: MomentConcept,
  insight: ConceptInsight | undefined,
  attendeesOf: (session: MomentSession) => MomentAttendee[],
  seed: number,
): CardQuote[] {
  if (insight && insight.quotes.length > 0) {
    return insight.quotes.map((q) => ({ text: q.text, byline: q.byline, isPlaceholder: false }));
  }
  return concept.contributing.slice(0, 2).map((session, qi) => ({
    text: placeholderQuoteFor(seed * 3 + qi),
    byline: attributionFor(attendeesOf(session), seed * 3 + qi),
    isPlaceholder: true,
  }));
}
