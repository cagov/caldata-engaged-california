/**
 * Types, schema, and pure validation/derivation logic for the authored
 * Phase 1 -> Phase 2 concept crosswalk (config/phase-crosswalk.json). No file
 * I/O beyond loadCrosswalk's own readFileSync — everything else here is pure
 * and unit-tested, matching lib/codebook.ts's and lib/roomsData.ts's split
 * between "parse from disk" and "shape/validate the parsed value."
 *
 * The crosswalk is INTERPRETIVE, not measured (the README's discovery/
 * classification distinction has no Phase-1-to-Phase-2 analogue — nothing
 * in the pipeline ever elicited this mapping from a respondent). Every
 * source object therefore carries a mandatory human-readable rationale, and
 * the file's own `status` field gates whether the viz treats it as reviewed.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

export type Strength = "primary" | "secondary" | "tangential";

/** Primary relevance counts three times as much as tangential when a
 * concept's incoming Phase 1 weight is computed (viz/src/lib/distill.ts
 * duplicates this constant rather than importing it — viz/ shares no code
 * with analysis/, per roomsData.ts's own documented convention). */
export const STRENGTH_WEIGHT: Record<Strength, number> = { primary: 3, secondary: 2, tangential: 1 };

const SourceSchema = z.object({
  code: z.string().min(1),
  field: z.enum(["personal", "economy", "government"]),
  strength: z.enum(["primary", "secondary", "tangential"]),
  rationale: z.string().min(1),
});

const ConceptEntrySchema = z.object({
  conceptId: z.string().min(1),
  sources: z.array(SourceSchema).min(1),
});

const PhaseCrosswalkSchema = z.object({
  version: z.string().min(1),
  codebookVersion: z.string().min(1),
  roomsSourceHash: z.string().min(1),
  status: z.enum(["proposed", "approved"]),
  approvedBy: z.string().nullable(),
  method: z.string().min(1),
  concepts: z.array(ConceptEntrySchema).min(1),
});

export type CrosswalkSource = z.infer<typeof SourceSchema>;
export type CrosswalkConceptEntry = z.infer<typeof ConceptEntrySchema>;
export type PhaseCrosswalkFile = z.infer<typeof PhaseCrosswalkSchema>;

export function loadCrosswalk(path: string): PhaseCrosswalkFile {
  const raw = readFileSync(path, "utf-8");
  return PhaseCrosswalkSchema.parse(JSON.parse(raw));
}

export interface ValidateOpts {
  /** Every concept id that must appear exactly once — from rooms.json's own concepts[].id. */
  conceptIds: string[];
  /** The live codebook's own version string — must match the crosswalk's claim. */
  codebookVersion: string;
  /** rooms.json's own meta.sourceHash — must match the crosswalk's claim. */
  roomsSourceHash: string;
  /** Every valid theme code across all three questions (respondents.json meta.themes[].code). */
  themeCodes: string[];
  /** questionId -> theme code -> respondent count. Used to flag an edge
   * whose field has zero respondents for that theme — a technically valid
   * reference that would draw an invisible, zero-width ribbon while still
   * removing the theme from the "did not carry forward" set, silently
   * corrupting that headline claim. */
  themeCountsByField: Record<string, Record<string, number>>;
}

/**
 * Fails loudly rather than silently emitting a broken graph (per the spec's
 * Task 1b). Returns every problem found, not just the first, so a human
 * fixing the crosswalk sees the whole list in one pass. Empty array = valid.
 */
export function validateCrosswalk(crosswalk: PhaseCrosswalkFile, opts: ValidateOpts): string[] {
  const errors: string[] = [];

  if (crosswalk.codebookVersion !== opts.codebookVersion) {
    errors.push(
      `codebookVersion mismatch: crosswalk claims "${crosswalk.codebookVersion}", live codebook is "${opts.codebookVersion}" — re-review the crosswalk against the current codebook before proceeding.`,
    );
  }
  if (crosswalk.roomsSourceHash !== opts.roomsSourceHash) {
    errors.push(
      `roomsSourceHash mismatch: crosswalk claims "${crosswalk.roomsSourceHash}", rooms.json's own sourceHash is "${opts.roomsSourceHash}" — the workbook changed since this crosswalk was authored.`,
    );
  }

  const themeCodeSet = new Set(opts.themeCodes);
  const expectedConceptIds = new Set(opts.conceptIds);
  const seenConceptIds = new Set<string>();

  for (const concept of crosswalk.concepts) {
    if (seenConceptIds.has(concept.conceptId)) {
      errors.push(`duplicate conceptId "${concept.conceptId}"`);
    }
    seenConceptIds.add(concept.conceptId);

    if (!expectedConceptIds.has(concept.conceptId)) {
      errors.push(`conceptId "${concept.conceptId}" does not exist in rooms.json`);
    }

    const seenCodesInConcept = new Set<string>();
    for (const source of concept.sources) {
      if (!themeCodeSet.has(source.code)) {
        errors.push(`${concept.conceptId}: theme code "${source.code}" does not exist in the codebook`);
      }
      if (source.rationale.trim().length === 0) {
        errors.push(`${concept.conceptId}/${source.code}: empty rationale`);
      }

      if (seenCodesInConcept.has(source.code)) {
        errors.push(`${concept.conceptId}: theme code "${source.code}" is cited twice — a concept may cite each theme at most once`);
      }
      seenCodesInConcept.add(source.code);

      const count = opts.themeCountsByField[source.field]?.[source.code];
      if (count === 0) {
        errors.push(
          `${concept.conceptId}/${source.code}: zero respondents raised this theme under "${source.field}" — this edge would draw an invisible ribbon while still marking the theme as claimed; either drop it or pick a field where this theme actually has a nonzero count`,
        );
      }
    }
  }

  for (const expected of expectedConceptIds) {
    if (!seenConceptIds.has(expected)) {
      errors.push(`conceptId "${expected}" is missing from the crosswalk — every rooms.json concept must be covered`);
    }
  }

  return errors;
}

/**
 * Themes cited by NO concept's sources — the "did not carry forward" set,
 * derived rather than hand-picked (see the spec's rationale for anchoring
 * the crosswalk on Phase 2 first). `themes` is meant to be the full 112-entry
 * respondents.json meta.themes list, one row per {code, home}.
 */
export function computeUnclaimed<T extends { code: string }>(crosswalk: PhaseCrosswalkFile, themes: T[]): T[] {
  const claimed = new Set(crosswalk.concepts.flatMap((c) => c.sources.map((s) => s.code)));
  return themes.filter((t) => !claimed.has(t.code));
}

export interface ConceptMetrics {
  sessionsPct: number;
  topPct: number;
  voteToIdeaRatio: number;
  compositePctSum: number;
  compositeCountSum: number;
}

/**
 * Reproduces the v2 CSV's own ranking columns exactly, computed from
 * rooms.json's already-built numbers rather than re-reading the spreadsheet
 * — see crosswalk.test.ts's parity test. Two quirks confirmed by hand
 * against the CSV, both preserved here: (1) "Vote to idea ratio" is the
 * PARENT SUBTHEME's votes/ideas, broadcast to every concept under it, not
 * the concept's own ratio; (2) "Sessions %" is out of the workbook's fixed
 * 14 total sessions, not out of the subtheme's own session count.
 * A third quirk: this uses rooms.json's RECONCILED subtheme votes/ideas
 * (the caller's `parentSubtheme` argument), not the workbook's STATED
 * header total — these agree for 7 of 8 subthemes but diverge for
 * "Empowering people to protect their data" (stated 82/24, reconciled
 * 94/26; see rooms.json's own meta.reconciliation and docs/SOURCE.md).
 * Reconciled values are used deliberately, matching this pipeline's
 * broader preference for recomputed numbers over stated workbook text.
 */
export function computeConceptMetrics(
  concept: { sessions: number; ideas: number; topIdeas: number },
  parentSubtheme: { votes: number; ideas: number },
  totalSessions: number,
): ConceptMetrics {
  const sessionsPct = Math.round((concept.sessions / totalSessions) * 100);
  const topPct = concept.ideas > 0 ? Math.round((concept.topIdeas / concept.ideas) * 100) : 0;
  const voteToIdeaRatio = parentSubtheme.ideas > 0 ? parentSubtheme.votes / parentSubtheme.ideas : 0;
  return {
    sessionsPct,
    topPct,
    voteToIdeaRatio,
    compositePctSum: sessionsPct + topPct,
    compositeCountSum: concept.sessions + concept.topIdeas,
  };
}
