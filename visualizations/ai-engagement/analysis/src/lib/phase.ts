/**
 * Pure data-shaping for the Phase 1 / Phase 2 viz breakdown. No file I/O here
 * — the stage (s12-vizdata.ts) does the reading; this module is
 * unit-testable without touching disk. Mirrors vizdata.ts's split.
 *
 * Phase 2 is defined as "appears in the attendee demographics export with a
 * matching SURVEY_RESPONDENT_ID" — see docs/SOURCE.md for why that's 101
 * respondents, not the 173 registrants a design deck elsewhere cites.
 */

export const PHASE_COLUMN = "PHASE";
export const PHASE_1 = "Phase 1 only (survey)";
export const PHASE_2 = "Phase 2 (deliberation)";

/** Every SURVEY_RESPONDENT_ID that appears in the attendee demographics
 * export, regardless of ATTENDEE_STATUS — the export only ever contains
 * people who showed up to a session (102 "attended", 1 blank status that
 * still names a real attendee), so there is no separate not-attended row to
 * filter out here. */
export function attendeeIds(attendeeRows: Record<string, string>[], idColumn: string): Set<string> {
  return new Set(attendeeRows.map((row) => row[idColumn]).filter((id) => id));
}

/** Returns a copy of `rows` with PHASE_COLUMN set on every row — never
 * mutates its input, same convention as s02-clean's row-shaping. */
export function withPhaseColumn(
  rows: Record<string, string>[],
  ids: Set<string>,
  idColumn: string,
): Record<string, string>[] {
  return rows.map((row) => ({
    ...row,
    [PHASE_COLUMN]: ids.has(row[idColumn]) ? PHASE_2 : PHASE_1,
  }));
}

/** Attendee ids with no matching row in `rows` — the reconciliation number
 * s12-vizdata prints alongside the export (expected: 2, per docs/SOURCE.md's
 * open item). Order follows `ids`' iteration order. */
export function unmatchedAttendees(rows: Record<string, string>[], ids: Set<string>, idColumn: string): string[] {
  const present = new Set(rows.map((row) => row[idColumn]));
  return [...ids].filter((id) => !present.has(id));
}
