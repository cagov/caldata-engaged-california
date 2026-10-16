import { z } from "zod";
import type { RoomsData } from "./roomsData.ts";

/**
 * Task 6 (⛔ gated): classifies each of the 157 deliberation-room policy
 * ideas against one of the 29 policy concepts in `rooms.json`'s `concepts`
 * array, mirroring `lib/classify.ts`'s pattern (system/user prompt builders,
 * a JSON schema constant, a non-throwing-on-content zod validator) but
 * single-label rather than multi-label: an idea gets at most one concept.
 *
 * This module is pure — no file I/O, no network calls. It only ever produces
 * a *proposal*: a plain `{ideaId, conceptId}` mapping plus a reconciliation
 * table for a human to review. Per README data rule 1 and this task's brief,
 * nothing here writes to `rooms.json`, flips `meta.hasIdeaLinkage`, or
 * otherwise treats the proposal as accepted — that merge is separate,
 * later, human-approved work.
 */

// --- Concept shape this module classifies against ---------------------------

export interface IdeaConceptTarget {
  id: string;
  name: string;
  subthemeId: string;
  themeId: string;
}

/**
 * The stable, cacheable system prompt: every concept id+name, grouped under
 * its theme id and subtheme id (the same descriptive grouping
 * `buildClassifySystem` uses for codes under questions), plus the
 * single-label classification rules.
 *
 * The concept list this module receives (`RoomsData["concepts"]`, see
 * `roomsData.ts`) only carries theme/subtheme *ids* (e.g. "T1", "ST-01"),
 * not human-readable theme/subtheme names — sheet 1 attaches names to
 * subthemes but this module's input type deliberately doesn't carry that
 * name through, so groupings below are labeled by id. That's enough for the
 * model to see which concepts cluster together; a human reviewing the
 * proposal has `rooms.json` itself for the readable names.
 */
export function buildIdeaConceptSystem(concepts: IdeaConceptTarget[]): string {
  const byTheme = new Map<string, Map<string, IdeaConceptTarget[]>>();
  for (const c of concepts) {
    if (!byTheme.has(c.themeId)) byTheme.set(c.themeId, new Map());
    const bySubtheme = byTheme.get(c.themeId)!;
    if (!bySubtheme.has(c.subthemeId)) bySubtheme.set(c.subthemeId, []);
    bySubtheme.get(c.subthemeId)!.push(c);
  }

  const themeBlocks = [...byTheme.entries()]
    .map(([themeId, bySubtheme]) => {
      const subthemeBlocks = [...bySubtheme.entries()]
        .map(([subthemeId, cs]) => {
          const lines = cs.map((c) => `  - ${c.id}: ${c.name}`).join("\n");
          return `  ${subthemeId}:\n${lines}`;
        })
        .join("\n");
      return `### ${themeId}\n${subthemeBlocks}`;
    })
    .join("\n\n");

  return `You are classifying policy ideas raised in small-group deliberation sessions on AI policy against a fixed list of policy concepts.

${themeBlocks}

Rules:
- This is single-label classification: assign exactly one concept id that best matches the idea, or null if no concept in the list above genuinely matches.
- Only use concept ids from the list above. Never invent a new id.
- null is a valid, correct answer when no concept genuinely matches — do not force a weak match.
- Respond only with the JSON object described by the schema — no prose.`;
}

/** Renders one idea's text for the user turn. */
export function buildIdeaConceptUser(ideaText: string): string {
  return `[Policy idea]\n${ideaText}`;
}

export const IDEA_CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    conceptId: { type: ["string", "null"] },
  },
  required: ["conceptId"],
  additionalProperties: false,
} as const;

const ideaConceptPayloadSchema = z.object({
  conceptId: z.string().nullable(),
});

export interface IdeaConceptResult {
  conceptId: string | null;
  /** Set when the model returned a non-null id not present in the valid
   * concept list — filtered to null rather than thrown, mirroring
   * `validateLabels`'s "unknown code is not a structural failure"
   * philosophy. */
  unknownId?: string;
}

/**
 * Parses+validates one idea-classification response. Throws on structural
 * mismatch (wrong shape entirely, e.g. missing `conceptId` key — a
 * retry-worthy failure at the call site); a non-null `conceptId` that isn't
 * in `validConceptIds` is not structural failure, just filtered to `null`
 * with `unknownId` set for visibility/triage.
 */
export function validateIdeaConceptResponse(parsed: unknown, validConceptIds: Set<string>): IdeaConceptResult {
  const { conceptId } = ideaConceptPayloadSchema.parse(parsed);
  if (conceptId === null) return { conceptId: null };
  if (validConceptIds.has(conceptId)) return { conceptId };
  return { conceptId: null, unknownId: conceptId };
}

// --- Reconciliation checksum -------------------------------------------------

/** One concept's stated-vs-recomputed agreement (or disagreement) row. */
export interface ReconciliationRow {
  conceptId: string;
  name: string;
  statedIdeas: number;
  computedIdeas: number;
  statedVotes: number;
  computedVotes: number;
  statedSessions: number;
  computedSessions: number;
}

export interface ProposedIdea {
  id: string;
  sessionNumber: number;
  votes: number;
  conceptId: string | null;
}

/**
 * Given a PROPOSED idea->concept mapping (each idea carrying a candidate
 * `conceptId`, or null for "no match"), recomputes for every one of
 * `concepts` (all 29, not just mismatches — this report's whole purpose is
 * being independently checkable, so full agreement needs to be visible too):
 * how many ideas were assigned to it, the sum of their votes, and the number
 * of distinct session numbers among them — then places each recomputed
 * number next to that concept's own stated `ideas`/`votes`/`sessions` fields
 * (sheet 1's own counts, already present on `RoomsData["concepts"]`) for a
 * human to compare.
 *
 * This is a genuinely separate checksum from `RoomsData.meta.reconciliation`
 * (`roomsData.ts`'s `ReconciliationEntry`), which reports the workbook's own
 * internal sheet-vs-sheet disagreements and has nothing to do with a
 * proposed classification's agreement with the workbook.
 */
export function reconcileIdeaConceptMapping(
  concepts: RoomsData["concepts"],
  ideas: ProposedIdea[],
): ReconciliationRow[] {
  const byConcept = new Map<string, { ideas: number; votes: number; sessions: Set<number> }>();
  for (const idea of ideas) {
    if (idea.conceptId === null) continue;
    const agg = byConcept.get(idea.conceptId) ?? { ideas: 0, votes: 0, sessions: new Set<number>() };
    agg.ideas += 1;
    agg.votes += idea.votes;
    agg.sessions.add(idea.sessionNumber);
    byConcept.set(idea.conceptId, agg);
  }

  return concepts.map((c) => {
    const agg = byConcept.get(c.id) ?? { ideas: 0, votes: 0, sessions: new Set<number>() };
    return {
      conceptId: c.id,
      name: c.name,
      statedIdeas: c.ideas,
      computedIdeas: agg.ideas,
      statedVotes: c.votes,
      computedVotes: agg.votes,
      statedSessions: c.sessions,
      computedSessions: agg.sessions.size,
    };
  });
}
