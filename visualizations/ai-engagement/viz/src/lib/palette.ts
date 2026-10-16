/**
 * Categorical color assignment shared by every color-by-demographic
 * prototype. There is exactly one palette for the whole app — define it
 * here, not per-component — so two prototypes never disagree about what
 * color a category is.
 */

/** Primary categorical hues, in assignment order — the EC design system's
 * own "Data Viz" style tokens (1-9, then 11; 10 is a gray in that system and
 * isn't a categorical hue, see DATA_VIZ_NEUTRAL_LIGHT below). */
export const DATA_VIZ_CAT = [
  "#65ade1",
  "#c591da",
  "#6c8043",
  "#53cab0",
  "#e45d48",
  "#a9d4f2",
  "#6d4884",
  "#75bc60",
  "#ee9930",
  "#f2c3c7",
] as const;

/** The pre-2026-09 primary ramp, aka "ODI" in the funnel cloud's dev-only
 * palette review toggle (ParticipantFunnelCloud.svelte's `paletteVersion`) —
 * not used by any other view, and not a real user-facing option. Delete
 * once that review is done. */
export const DATA_VIZ_CAT_OLD = [
  "#0d4f8c",
  "#e3881b",
  "#634eaf",
  "#e45d48",
  "#3baa91",
  "#a35f0e",
  "#3d6a7f",
  "#058a32",
  "#825a99",
] as const;

/** Same 10 hues as DATA_VIZ_CAT, in a different assignment order — aka
 * "Engaged" in the same dev-only palette review toggle, so this reordering
 * can be compared against DATA_VIZ_CAT_OLD ("ODI") against the real
 * ring/session data rather than judged in the abstract. Delete alongside
 * DATA_VIZ_CAT_OLD once the review is done. */
export const DATA_VIZ_CAT_V2 = [
  "#53cab0",
  "#65ade1",
  "#c591da",
  "#ee9930",
  "#6d4884",
  "#e45d48",
  "#6c8043",
  "#a9d4f2",
  "#75bc60",
  "#f2c3c7",
] as const;

/** Overflow beyond DATA_VIZ_CAT's 10 primary hues, spent only once a segment
 * has more substantive categories than that (today, only FIELD_OF_WORK's 11
 * needs a single extra). Pre-dates the design system's own "Data Viz" ramp
 * above, so it isn't hue-paired with it the way it once was 1:1 with the old
 * 9-hue primary ramp — it's just the one extra distinct color this app has
 * ever needed. */
export const DATA_VIZ_CAT_LIGHTER = [
  "#7fa1c2",
  "#f4cea1",
  "#a395d5",
  "#eca995",
  "#98decd",
  "#ecac67",
  "#abccde",
  "#75bc60",
  "#c591da",
] as const;

/** Darker-for-text variants of DATA_VIZ_CAT_OLD's 9 hues ("ODI" in the
 * funnel cloud's dev-only palette review toggle) — for views that set body
 * text or word-cloud labels in a categorical color rather than filling a
 * swatch, where a few of DATA_VIZ_CAT_OLD's hues (#e3881b, #e45d48,
 * #3baa91, #058a32) don't quite clear WCAG 1.4.3 against a white surface
 * as-is. Drops #e3881b — its darkened form (#aa6614) landed only ~12 RGB
 * units from #a35f0e below, too close to stay distinct at only 8 slots —
 * rather than darkening all 9. Each hand-verified at >=4.5:1 against
 * #ffffff (see viz/tests/palette.test.ts's own contrast check); not
 * swapped in for dark mode — same known gap as DATA_VIZ_NEUTRAL_LIGHT
 * below, not fixed here. Used by phase1CloudDraw.ts, indexed by
 * Phase1Subtheme index (phase1ConceptsData.ts has exactly 8 subthemes,
 * matching this ramp's length 1:1). */
export const DATA_VIZ_CAT_OLD_TEXT = [
  "#0d4f8c", // = DATA_VIZ_CAT_OLD[0], already 8.35:1, no darkening needed
  "#634eaf", // = DATA_VIZ_CAT_OLD[2], already 6.48:1, no darkening needed
  "#c24f3d", // from #e45d48 (DATA_VIZ_CAT_OLD[3]), 4.69:1
  "#2c806d", // from #3baa91 (DATA_VIZ_CAT_OLD[4]), 4.76:1
  "#a35f0e", // = DATA_VIZ_CAT_OLD[5], already 5.00:1, no darkening needed
  "#3d6a7f", // = DATA_VIZ_CAT_OLD[6], already 5.89:1, no darkening needed
  "#04752b", // from #058a32 (DATA_VIZ_CAT_OLD[7]), 5.86:1
  "#825a99", // = DATA_VIZ_CAT_OLD[8], already 5.42:1, no darkening needed
] as const;

/** Darker-for-text variants of 8 of DATA_VIZ_CAT_V2's 10 hues ("Engaged" in
 * the same dev-only toggle — the same hue set as DATA_VIZ_CAT, just
 * reordered) — same rationale as DATA_VIZ_CAT_OLD_TEXT above. Drops
 * #a9d4f2 and #75bc60 (their darkened forms sat within ~30 RGB units of
 * #427092/#5c6d39 below — too close to stay distinct at only 8 slots)
 * rather than darkening all 10. Each hand-verified at >=4.5:1 against
 * #ffffff. */
export const DATA_VIZ_CAT_V2_TEXT = [
  "#427092", // from #65ade1, 5.30:1
  "#805e8e", // from #c591da, 5.37:1
  "#5c6d39", // from #6c8043, 5.67:1
  "#368372", // from #53cab0, 4.52:1
  "#c24f3d", // from #e45d48, 4.69:1
  "#5d3d70", // from #6d4884, 8.87:1
  "#9b631f", // from #ee9930, 5.00:1
  "#856b6d", // from #f2c3c7, 4.86:1
] as const;

/** Non-substantive answer buckets share this neutral instead of spending a
 * categorical hue — see isNonAnswer below. */
export const DATA_VIZ_NEUTRAL_LIGHT = "#bcbbc1";

// "I don't want to say" is a refusal, not a blank — the README's data rules require it
// stay its own category everywhere. "(not stated)" is the export's fill-in
// for a missing raw value. Both are non-substantive: color-by-demographic
// views render them neutral so they don't compete with real categories or
// consume a hue, but they still get their own legend row.
const NON_ANSWER = new Set(["(not stated)", "I don't want to say"]);

export function isNonAnswer(value: string): boolean {
  return NON_ANSWER.has(value);
}

/**
 * Assigns one color per entry in `values` (a segment's display categories,
 * in their existing order — same order as SegmentMeta.values / groupOf
 * indices). Non-answer entries get DATA_VIZ_NEUTRAL_LIGHT; every other
 * entry takes the next unused color from `primaryRamp`, then
 * DATA_VIZ_CAT_LIGHTER once the primary ramp is spent.
 *
 * `primaryRamp` defaults to DATA_VIZ_CAT — every real caller should leave it
 * at the default; the parameter exists only so ParticipantFunnelCloud.svelte's
 * dev-only palette review toggle can pass DATA_VIZ_CAT_OLD ("ODI") or
 * DATA_VIZ_CAT_V2 ("Engaged") instead.
 *
 * Only FIELD_OF_WORK (12 values, 1 non-answer, 11 substantive) needs the
 * lighter ramp today, and only for its 11th category; every other segment's
 * substantive category count (REGION 8, AGE 5, GENDER_CATEGORY 4,
 * RACE_ETHNICITY_CATEGORY 8, CURRENT_WORK_STATUS 3, ROLE_AT_WORK 6) fits
 * inside the 10 primary hues.
 */
export function assignCategoryColors(values: string[], primaryRamp: readonly string[] = DATA_VIZ_CAT): string[] {
  const ramp = [...primaryRamp, ...DATA_VIZ_CAT_LIGHTER];
  let cursor = 0;
  return values.map((value) => {
    if (isNonAnswer(value)) return DATA_VIZ_NEUTRAL_LIGHT;
    const color = ramp[cursor % ramp.length];
    cursor++;
    return color;
  });
}

/**
 * Stance (AI_RESPONSE_LABEL) needs 4 mutually-distinguishable substantive
 * colors. Rather than draw from DATA_VIZ_CAT (whose 10 hues are picked for
 * distinctness across up to 10-11 categories, not specifically validated as
 * a standalone 4-hue set), Negative/Mixed/Positive keep their own separate,
 * fixed hues — validated with the dataviz skill's validate_palette.js as an
 * all-pairs-safe 3-hue set in both CVD and normal vision (CVD ΔE 10.0,
 * normal-vision ΔE 21.5) — independent of whatever DATA_VIZ_CAT happens to
 * contain. Neutral — the rarest bucket and semantically the closest thing to
 * "no strong signal" — gets a second, distinct gray instead of a fourth hue:
 * this app's own --muted secondary-ink token, contrast-checked at 4.16:1
 * against DATA_VIZ_NEUTRAL_LIGHT so the two grays don't read as the same
 * "no data" bucket.
 */
export const SENTIMENT_STANCE_COLORS: Record<string, string> = {
  Negative: "#e45d48",
  Mixed: "#825a99",
  Neutral: "#52514e",
  Positive: "#3baa91",
};

/**
 * Single dispatch point so the whole app still draws from exactly one
 * palette module: AI_RESPONSE_LABEL gets the stance treatment above, every
 * other segment keeps the ordinary categorical ramp.
 */
export function colorsForSegment(key: string, values: string[]): string[] {
  if (key !== "AI_RESPONSE_LABEL") return assignCategoryColors(values);
  return values.map((value) => (isNonAnswer(value) ? DATA_VIZ_NEUTRAL_LIGHT : (SENTIMENT_STANCE_COLORS[value] ?? DATA_VIZ_NEUTRAL_LIGHT)));
}
