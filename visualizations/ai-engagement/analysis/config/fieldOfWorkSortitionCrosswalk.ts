/**
 * Maps `attendee demographics`'s FIELD_OF_WORK_SORTITION_GROUPING (phase 2
 * attendees) onto the same category labels as `FIELD_OF_WORK_ROLLUP` (phase
 * 1 survey respondents, in survey respondent demographics 2026-08-28.csv) —
 * two independent exports rolled up the same underlying field-of-work
 * question into near-identical categories under different names. Only
 * renames are listed; every other raw value already matches its phase 1
 * rollup label and passes through unchanged (see funnel.ts).
 *
 * Values with no entry here — including any value not observed when this
 * was written — pass through unchanged rather than folding into "Other";
 * unlike fieldOfWorkCrosswalk.ts's raw survey text, sortition grouping
 * values are already hand-rolled categories, so an unmapped one is far more
 * likely a label this table hasn't caught up to than a true one-off.
 */
export const FIELD_OF_WORK_SORTITION_CROSSWALK: Record<string, string> = {
  "Arts, entertainment, or media": "Creative",
  "Retail or wholesale trade": "Retail",
  "Unemployed, looking": "I don't currently work",
};
