/**
 * Maps FIELD_OF_WORK's raw survey values (24 distinct, from the current
 * export) to a small set of general categories for the beeswarm chart axis.
 *
 * Finalized. Edit this file directly to change a mapping, then re-run
 * `npm run vizdata` in analysis/ to regenerate the export — no other code
 * needs to change.
 *
 * Values with no clean fit in the target categories (construction,
 * manufacturing, hospitality, non-profit, agriculture, utilities, mining —
 * each its own distinct sector, none matching a named bucket here) were
 * left in "Other" rather than forced into a misleading category. That
 * makes "Other" the single largest bucket (n≈529 of 2,678) — revisit if a
 * finer breakdown becomes worth the added chart complexity.
 *
 * Two raw values are deliberately excluded from this table and from
 * "Other": "I don't currently work" and "I don't want to say" aren't fields
 * of work at all, so they pass through as their own category untouched
 * (see FIELD_OF_WORK_PASSTHROUGH / REFUSAL_VALUE in vizdata.ts).
 *
 * Any raw value with no entry here — including the literal survey value
 * "Other" — falls back to "Other".
 */

export const FIELD_OF_WORK_CATEGORIES = [
  "Professional, scientific, and technical",
  "Information technology",
  "Finance & insurance",
  "Logistics",
  "Public sector",
  "Retail",
  "Education",
  "Healthcare",
  "Creative industries",
  "Other",
] as const;

export const FIELD_OF_WORK_CROSSWALK: Record<string, string> = {
  Government: "Public sector",
  "Information technology": "Information technology",
  "Arts, entertainment, or media": "Creative industries",
  Education: "Education",
  Healthcare: "Healthcare",
  "Retail or wholesale trade": "Retail",
  "Architecture or engineering": "Professional, scientific, and technical",
  Finance: "Finance & insurance",
  Science: "Professional, scientific, and technical",
  Legal: "Professional, scientific, and technical",
  "Transportation or warehousing": "Logistics",
  Insurance: "Finance & insurance",

  // Real estate/leasing groups with Finance & insurance under the
  // conventional "FIRE" (finance, insurance, real estate) sector grouping.
  "Real estate or leasing": "Finance & insurance",

  // Corporate ownership/governance is a professional-executive function
  // rather than an industry of its own — grouped with the other
  // professional-services roles (architecture, science, legal).
  "Corporate ownership or governance": "Professional, scientific, and technical",

  // Each of these is its own distinct sector with no match among the named
  // categories above — left in "Other" rather than forced into a
  // misleading bucket:
  "Non-profit": "Other", // 140 respondents — organizational form, not an industry; spans all sectors
  Construction: "Other", // 40
  Manufacturing: "Other", // 40
  Hospitality: "Other", // 38
  "Agriculture, forestry, or fishing": "Other", // 17
  "Utilities or waste management": "Other", // 13 — ownership mix (public/private) too, no clean fit
  "Mining, quarrying, or oil and gas extraction": "Other", // 1
};
