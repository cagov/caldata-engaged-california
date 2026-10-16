/**
 * Fetches the hand-authored "Engaged California early insights preview"
 * copy — real quotes and plain-language names for a handful of rooms.json
 * concepts, keyed by concept id. Mirrors funnelData.ts / roomsData.ts's fetch
 * shape, but this file is optional: unlike funnel.json/rooms.json it's not
 * produced by an analysis stage, so a fresh clone (or a build before someone
 * authors it) has no /insights.json at all. A 404 resolves to `null` rather
 * than throwing — callers fall back to the existing placeholder copy, never
 * blank the prototype.
 */

export interface InsightQuote {
  text: string;
  byline: string;
}

export interface ConceptInsight {
  name?: string;
  quotes: InsightQuote[];
}

/** A real quote to show in a session's "Behind the curtain" peek card
 * (conversationPeek.ts), in place of that card's usual 3-turn placeholder
 * exchange — see conversationPeek.ts's own turnsFor for why a session with
 * an override shows only these turns, not a mix of real and placeholder.
 * `byline` is optional, unlike ConceptInsight's quotes: omit it to
 * attribute the quote to a real (but unverified) attendee of the session
 * instead, via the same attributionFor(...) convention the placeholder
 * turns and deliberativeMoments.ts's cardQuotesFor both fall back to when a
 * quote's actual speaker isn't confirmed. `region`/`fieldOfWork` only
 * matter alongside an explicit `byline` (they drive the turn's speaker-dot
 * color — same raw category values funnel.json's regions/fieldOfWork use,
 * e.g. "Los Angeles", "Creative" — a byline-less turn colors from the real
 * attendee attributionFor picked instead). */
export interface SessionInsightTurn {
  text: string;
  byline?: string;
  region?: string;
  fieldOfWork?: string;
}

/** A session's own entry in `InsightsData.sessions` — its real turns, plus
 * which rooms.json policy concept this conversation's quotes are being
 * shown alongside. `linkedConceptId` is a hand-authored editorial choice,
 * same as everything else in this file — not derived from real per-idea
 * concept linkage (see deliberativeMoments.ts's own caution about exactly
 * this: pairing a quote with session data it doesn't actually name would
 * fabricate provenance). Resolved against `concepts[linkedConceptId]?.name`
 * first, then rooms.json's own concept name, so the "This turned into"
 * caption never goes stale if this file's plain-language rewrite changes. */
export interface SessionInsight {
  turns: SessionInsightTurn[];
  linkedConceptId?: string;
}

export interface InsightsData {
  meta: { source: string; note: string };
  concepts: Record<string, ConceptInsight>;
  /** Keyed by rooms.json session number as a string (e.g. "8") — optional,
   * same "absent means every session keeps its placeholder copy" contract
   * as `concepts` and this whole file. */
  sessions?: Record<string, SessionInsight>;
}

export async function fetchInsights(): Promise<InsightsData | null> {
  const res = await fetch("/insights.json");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load insights.json: ${res.status}`);
  return res.json();
}
