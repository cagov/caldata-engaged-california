import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignCategoryColors,
  colorsForSegment,
  isNonAnswer,
  DATA_VIZ_CAT,
  DATA_VIZ_CAT_LIGHTER,
  DATA_VIZ_CAT_OLD_TEXT,
  DATA_VIZ_CAT_V2_TEXT,
  DATA_VIZ_NEUTRAL_LIGHT,
  SENTIMENT_STANCE_COLORS,
} from "../src/lib/palette.ts";

test("isNonAnswer recognizes both non-substantive buckets and nothing else", () => {
  assert.ok(isNonAnswer("(not stated)"));
  assert.ok(isNonAnswer("I don't want to say"));
  assert.ok(!isNonAnswer("White"));
  assert.ok(!isNonAnswer("Woman"));
});

test("non-answer categories get the neutral color, never a hue", () => {
  const colors = assignCategoryColors(["White", "(not stated)", "Asian", "I don't want to say"]);
  assert.equal(colors[1], DATA_VIZ_NEUTRAL_LIGHT);
  assert.equal(colors[3], DATA_VIZ_NEUTRAL_LIGHT);
  assert.notEqual(colors[0], DATA_VIZ_NEUTRAL_LIGHT);
  assert.notEqual(colors[2], DATA_VIZ_NEUTRAL_LIGHT);
});

test("every substantive category gets a distinct color, in order, from the primary ramp", () => {
  // Mirrors RACE_ETHNICITY_CATEGORY: 8 substantive values + 1 non-answer.
  const values = ["White", "Hispanic or Latino", "Asian", "Multiple", "Black or African American",
    "Middle Eastern or North African", "American Indian or Alaska Native", "Native Hawaiian or Pacific Islander",
    "(not stated)"];
  const colors = assignCategoryColors(values);
  const substantive = colors.slice(0, 8);
  assert.deepEqual(substantive, DATA_VIZ_CAT.slice(0, 8));
  assert.equal(colors[8], DATA_VIZ_NEUTRAL_LIGHT);
  assert.equal(new Set(substantive).size, 8, "every substantive category should get a distinct color");
});

test("a segment with more substantive categories than primary hues spills into the lighter ramp", () => {
  // Mirrors FIELD_OF_WORK: 12 display values, 1 non-answer, 11 substantive —
  // one more than DATA_VIZ_CAT's 10 primary hues, so exactly 1 category
  // spills into DATA_VIZ_CAT_LIGHTER.
  const values = [
    "Other", "Public sector", "Information technology", "Creative industries", "Education",
    "Professional, scientific, and technical", "Healthcare", "I don't currently work",
    "Finance & insurance", "Retail", "Logistics", "I don't want to say",
  ];
  const colors = assignCategoryColors(values);
  assert.equal(colors.length, 12);
  assert.equal(colors[11], DATA_VIZ_NEUTRAL_LIGHT);

  const substantive = colors.slice(0, 11);
  assert.deepEqual(substantive.slice(0, 10), DATA_VIZ_CAT);
  assert.deepEqual(substantive.slice(10, 11), DATA_VIZ_CAT_LIGHTER.slice(0, 1));
  assert.equal(new Set(substantive).size, 11, "every substantive category should still get a distinct color");
});

test("colorsForSegment gives AI_RESPONSE_LABEL its fixed stance colors regardless of position", () => {
  const colors = colorsForSegment("AI_RESPONSE_LABEL", ["Positive", "Neutral", "Negative", "Mixed", "(not stated)"]);
  assert.equal(colors[0], SENTIMENT_STANCE_COLORS.Positive);
  assert.equal(colors[1], SENTIMENT_STANCE_COLORS.Neutral);
  assert.equal(colors[2], SENTIMENT_STANCE_COLORS.Negative);
  assert.equal(colors[3], SENTIMENT_STANCE_COLORS.Mixed);
  assert.equal(colors[4], DATA_VIZ_NEUTRAL_LIGHT);
});

test("colorsForSegment keeps Neutral's stance gray distinct from the (not stated) non-answer gray", () => {
  assert.notEqual(SENTIMENT_STANCE_COLORS.Neutral, DATA_VIZ_NEUTRAL_LIGHT);
});

test("colorsForSegment falls back to assignCategoryColors for every non-stance segment", () => {
  const values = ["White", "Asian", "(not stated)"];
  assert.deepEqual(colorsForSegment("RACE_ETHNICITY_CATEGORY", values), assignCategoryColors(values));
});

function relLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

for (const [name, ramp] of [
  ["DATA_VIZ_CAT_OLD_TEXT", DATA_VIZ_CAT_OLD_TEXT],
  ["DATA_VIZ_CAT_V2_TEXT", DATA_VIZ_CAT_V2_TEXT],
] as const) {
  test(`${name} has 8 distinct hues, one per Phase 1 subtheme`, () => {
    assert.equal(ramp.length, 8);
    assert.equal(new Set(ramp).size, 8);
  });

  test(`every ${name} hue clears 4.5:1 contrast against white`, () => {
    for (const hex of ramp) {
      const contrast = (1 + 0.05) / (relLuminance(hex) + 0.05);
      assert.ok(contrast >= 4.5, `${hex} only clears ${contrast.toFixed(2)}:1 against white`);
    }
  });
}
