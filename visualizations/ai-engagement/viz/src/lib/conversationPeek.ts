/**
 * Pure data-shaping for the funnel-cloud prototype's stage 4, "Behind the
 * curtain" — a per-conversation chat-style peek, shown before stage 5's
 * cross-conversation "Deliberative moments" sidebar. Where deliberativeMoments.ts
 * answers "which conversations raised this concept?", this module answers
 * "what did any one conversation sound like?" and deliberately never looks at
 * policy concepts at all — see this module's own header note on that split.
 *
 * One of only two files in viz/ that import both funnelCloud.ts and
 * roomsData.ts (see deliberativeMoments.ts's header comment for the other).
 * Reuses deliberativeMoments.ts's own joinBySessionNumber/attributionFor
 * rather than re-deriving the date join or the byline phrasing, and stays
 * DOM-free so it's testable without mounting a component, same convention as
 * deliberativeMoments.ts/roomsRank.ts.
 *
 * Quotes are placeholder by default — no transcript data exists in this
 * repo (the data/Phase2_convo_*.csv files are attendee demographics, not
 * dialogue), and README data rule 2 forbids response text in git regardless.
 * A session named in insights.json's optional `sessions` map (see
 * insightsData.ts's SessionInsightTurn) gets that hand-authored real quote
 * instead — insights.json itself lives under the gitignored
 * analysis/artifacts/ tree specifically so a real quote can exist at
 * runtime without ever reaching git, same pattern deliberativeMoments.ts's
 * cardQuotesFor already established for the Moments sidebar. Every
 * placeholder turn carries isPlaceholder: true so a caller can badge it,
 * same convention as deliberativeMoments.ts's CardQuote; a real override
 * turn carries isPlaceholder: false.
 */
import type { Cluster } from "./funnelCloud.ts";
import type { RoomsData } from "./roomsData.ts";
import type { InsightsData, SessionInsight, SessionInsightTurn } from "./insightsData.ts";
import { attributionFor, joinBySessionNumber, type MomentAttendee } from "./deliberativeMoments.ts";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Formats a cluster's raw "YYYY-MM-DD" date string as "July 17" — by
 * hand-parsing the parts, not `new Date(iso)`, which parses as UTC and can
 * render the previous day once formatted back out in a negative-UTC-offset
 * timezone like America/Los_Angeles. */
export function sessionDateLabel(iso: string): string {
  const [, monthStr, dayStr] = iso.split("-");
  const month = MONTH_NAMES[Number(monthStr) - 1] ?? "";
  const day = Number(dayStr);
  return `${month} ${day}`;
}

interface PeekTurnSet {
  observation: string;
  agreement: string;
  proposal: string;
}

/** Obviously-placeholder chat text, shaped like the reference mock's own arc
 * (an observation, agreement, then a proposal) — several sets so different
 * conversations don't all show identical filler. Rotated deterministically
 * by clusterIndex, same convention as deliberativeMoments.ts's
 * PLACEHOLDER_QUOTES. */
const PEEK_TURN_SETS: PeekTurnSet[] = [
  {
    observation: "Placeholder — an opening observation from this conversation would appear here.",
    agreement: "Placeholder — I agree, and here's why that matters to me.",
    proposal: "Placeholder — let's propose the policy wording as this.",
  },
  {
    observation: "Placeholder — someone raises a concern they've run into personally.",
    agreement: "Placeholder — that matches what I've seen too.",
    proposal: "Placeholder — what if the state required this instead?",
  },
  {
    observation: "Placeholder — a question about how this would actually work.",
    agreement: "Placeholder — good point, and it applies to my field as well.",
    proposal: "Placeholder — so the idea we'd want to submit is this.",
  },
  {
    observation: "Placeholder — a story about how this already showed up at work.",
    agreement: "Placeholder — same here, more often than I expected.",
    proposal: "Placeholder — let's write that up as a concrete ask.",
  },
];

const TURN_ROLES: (keyof PeekTurnSet)[] = ["observation", "agreement", "proposal"];

export interface PeekTurn {
  text: string;
  byline: string;
  /** Raw (not phrased) region/fieldOfWork of the real attendee this turn is
   * attributed to — the component colors the speaker dot from these via the
   * same colorOf map that colors the ring dots, so the chat recolors in step
   * with the Region/Field-of-work toggle. Empty string when the session has
   * no real attendees to attribute to (attributionFor's own "an attendee"
   * fallback, or a SessionInsightTurn override with no region/fieldOfWork
   * of its own), which the component's color lookup treats as unmatched. */
  region: string;
  fieldOfWork: string;
  isPlaceholder: boolean;
}

export interface ConversationPeek {
  clusterIndex: number;
  /** rooms.json's own session number, joined by date via
   * joinBySessionNumber — null when no rooms.json session shares this
   * cluster's date (never fabricated). */
  sessionNumber: number | null;
  date: string;
  dateLabel: string;
  attendeeCount: number;
  turns: PeekTurn[];
  /** The policy concept this conversation's real quotes are shown
   * alongside — see insightsData.ts's SessionInsight for why this is a
   * hand-authored editorial link, not derived linkage. Null whenever this
   * session has no insights.json override at all, or the override doesn't
   * name a linkedConceptId. */
  linkedConceptName: string | null;
}

/** Positive modulo — `n % m` in JS keeps the sign of `n`, which would return
 * a negative index for a negative seed. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function buildTurns(attendees: MomentAttendee[], seed: number): PeekTurn[] {
  const set = PEEK_TURN_SETS[mod(seed, PEEK_TURN_SETS.length)];
  const n = attendees.length;
  return TURN_ROLES.map((role, i) => {
    // Same index math attributionFor uses internally (seed % length,
    // wrapped positive) — offsetting by `i` across the fixed 3 roles lands
    // on 3 distinct attendees whenever the session has >= 3 of them, without
    // duplicating attributionFor's own phrase-building logic to get at the
    // raw attendee it picked.
    const attendee = n > 0 ? attendees[mod(seed + i, n)] : undefined;
    return {
      text: set[role],
      byline: attributionFor(attendees, seed + i),
      region: attendee?.region ?? "",
      fieldOfWork: attendee?.fieldOfWork ?? "",
      isPlaceholder: true,
    };
  });
}

/** A session named in `overrides` replaces its entire placeholder exchange
 * with just these real turns — not a mix of the two — same "real quotes
 * only, when any exist" rule cardQuotesFor already applies to the Moments
 * sidebar. A turn with no `byline` of its own falls back to
 * attributionFor, same seed+i indexing buildTurns uses, so it still names a
 * genuine attendee rather than going unattributed. */
function turnsFor(overrides: SessionInsightTurn[] | undefined, attendees: MomentAttendee[], seed: number): PeekTurn[] {
  if (!overrides || overrides.length === 0) return buildTurns(attendees, seed);
  const n = attendees.length;
  return overrides.map((o, i) => {
    if (o.byline) {
      return { text: o.text, byline: o.byline, region: o.region ?? "", fieldOfWork: o.fieldOfWork ?? "", isPlaceholder: false };
    }
    const attendee = n > 0 ? attendees[mod(seed + i, n)] : undefined;
    return {
      text: o.text,
      byline: attributionFor(attendees, seed + i),
      region: attendee?.region ?? "",
      fieldOfWork: attendee?.fieldOfWork ?? "",
      isPlaceholder: false,
    };
  });
}

/** `linkedConceptId` resolved to a display name — insights.json's own
 * plain-language rewrite first (same preference order displayNameFor uses
 * for the Moments sidebar), falling back to rooms.json's own concept name,
 * so a session's "This turned into" caption still resolves even for a
 * concept insights.json's `concepts` map has no entry for. Null if
 * `linkedConceptId` is missing or names no concept rooms.json actually
 * has. */
function linkedConceptNameFor(linkedConceptId: string | undefined, insights: InsightsData | null, rooms: RoomsData): string | null {
  if (!linkedConceptId) return null;
  const insightName = insights?.concepts[linkedConceptId]?.name;
  if (insightName) return insightName;
  return rooms.concepts.find((c) => c.id === linkedConceptId)?.name ?? null;
}

/**
 * One ConversationPeek per cluster, in the same order as `clusters` (ring
 * order) — `attendeesOf` supplies each cluster's real attendee list (the
 * component derives this from its own kept dots, same as
 * deliberativeMoments.ts's attendeesByCluster) so a turn's byline names a
 * genuine attendee of that conversation. `insights` is insights.json's own
 * fetched data (or null) — a session absent from its `sessions` map, or a
 * null `insights` altogether, keeps its placeholder exchange and no linked
 * concept, same "absent means placeholder" contract as the Moments
 * sidebar's own `insights` prop.
 */
export function buildConversationPeeks(
  clusters: Cluster[],
  rooms: RoomsData,
  attendeesOf: (clusterIndex: number) => MomentAttendee[],
  insights: InsightsData | null = null,
): ConversationPeek[] {
  const joinOf = joinBySessionNumber(rooms, clusters);
  const sessionNumberByCluster = new Map<number, number>();
  for (const [sessionNumber, join] of joinOf) sessionNumberByCluster.set(join.clusterIndex, sessionNumber);

  return clusters.map((cluster, clusterIndex) => {
    const attendees = attendeesOf(clusterIndex);
    const sessionNumber = sessionNumberByCluster.get(clusterIndex) ?? null;
    const sessionInsight: SessionInsight | undefined = sessionNumber !== null ? insights?.sessions?.[String(sessionNumber)] : undefined;
    return {
      clusterIndex,
      sessionNumber,
      date: cluster.date,
      dateLabel: sessionDateLabel(cluster.date),
      attendeeCount: attendees.length,
      turns: turnsFor(sessionInsight?.turns, attendees, clusterIndex),
      linkedConceptName: linkedConceptNameFor(sessionInsight?.linkedConceptId, insights, rooms),
    };
  });
}
