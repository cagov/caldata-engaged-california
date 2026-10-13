/**
 * Pure data-shaping for the beeswarm respondent explorer (viz/).
 * No file I/O here — the stage (s12-vizdata.ts) does the reading/writing;
 * this module is unit-testable without touching disk.
 */
import { FIELD_OF_WORK_CROSSWALK } from "../../config/fieldOfWorkCrosswalk.ts";
import { PHASE_COLUMN, PHASE_1, PHASE_2 } from "./phase.ts";

export const REFUSAL_VALUE = "I don't want to say";
export const NOT_STATED_VALUE = "(not stated)";

// Pinned categories always sort last, in this order, and are never folded
// into "Other" — a refusal or an absence is a category, not noise.
const PINNED_VALUES = [NOT_STATED_VALUE, REFUSAL_VALUE];

// AGE and PHASE are the segments with a real ordinal reading; every other
// segment sorts by descending count. Explicit orders, not left to fall out
// of count-sort, so a value order can't flip if the underlying counts ever
// shift (PHASE's 2,601-vs-101 split happens to sort the same way today, but
// that's not something this should depend on).
const ORDINAL_ORDERS: Record<string, string[]> = {
  AGE: ["Under 18", "18-24", "25-44", "45-64", "Over 65"],
  [PHASE_COLUMN]: [PHASE_1, PHASE_2],
};

// Not fields of work at all — pass through the FIELD_OF_WORK crosswalk
// unchanged rather than folding into "Other".
const FIELD_OF_WORK_PASSTHROUGH = new Set(["I don't currently work"]);

const SEGMENT_LABELS: Record<string, string> = {
  REGION: "Region",
  AGE: "Age",
  GENDER_CATEGORY: "Gender",
  RACE_ETHNICITY_CATEGORY: "Race / ethnicity",
  CURRENT_WORK_STATUS: "Current work status",
  ROLE_AT_WORK: "Role at work",
  FIELD_OF_WORK: "Field of work",
  AI_RESPONSE_LABEL: "Stance",
  [PHASE_COLUMN]: "Phase",
};

// AI_RESPONSE_LABEL's raw codes -> a friendly display label. Bijective (no
// many-to-one folding, unlike FIELD_OF_WORK's crosswalk), so no "Other"
// bucket and foldLongTail never triggers at 4 values. No ordinal order here:
// Negative/Mixed/Neutral/Positive don't sit on one line the way AGE does
// (Mixed isn't "between" Neutral and either pole), so this defaults to
// count-sort like every other non-AGE segment.
const AI_RESPONSE_LABEL_VALUES: Record<string, string> = {
  neg: "Negative",
  mix: "Mixed",
  neutral: "Neutral",
  pos: "Positive",
};

/** Segments with a bijective raw->display rename, keyed by segment key. */
const DISPLAY_VALUE_MAPS: Record<string, Record<string, string>> = {
  AI_RESPONSE_LABEL: AI_RESPONSE_LABEL_VALUES,
};

export interface SegmentMeta {
  key: string;
  label: string;
  /** Display/grouping dictionary — what the chart axis and blobs use. May
   * be folded (generic segments) or crosswalk-mapped (FIELD_OF_WORK). */
  values: string[];
  /** Every distinct raw survey value for this segment, never folded or
   * remapped — the source of truth for "who is this respondent really." */
  rawValues: string[];
}

type CountEntry = [value: string, count: number];

function isPinned(value: string): boolean {
  return PINNED_VALUES.includes(value);
}

/** AGE and PHASE sort ordinally; every other segment sorts by descending
 * count. */
function sortOrdinary(key: string, entries: CountEntry[]): CountEntry[] {
  const sorted = [...entries];
  const order = ORDINAL_ORDERS[key];
  if (order) {
    sorted.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  } else {
    sorted.sort((a, b) => b[1] - a[1]);
  }
  return sorted;
}

/**
 * Fold every entry past the top (max - 1) into a single "+N more" bucket.
 * Entries are assumed pre-sorted in display order; the fold always keeps the
 * leading (max - 1) entries and merges the remainder.
 */
export function foldLongTail(entries: CountEntry[], max: number): CountEntry[] {
  if (entries.length <= max) return entries;
  const kept = entries.slice(0, max - 1);
  const overflow = entries.slice(max - 1);
  const foldedCount = overflow.reduce((sum, [, count]) => sum + count, 0);
  return [...kept, [`+${overflow.length} more`, foldedCount]];
}

/**
 * FIELD_OF_WORK's raw survey value -> general category, per
 * config/fieldOfWorkCrosswalk.ts. Values with no crosswalk entry (including
 * the literal survey value "Other") default to "Other" rather than being
 * left as their own tiny bucket; the two non-work values pass through
 * unchanged; pinned values (refusal / not-stated) pass through unchanged.
 */
function fieldOfWorkDisplayValue(raw: string): string {
  if (isPinned(raw) || FIELD_OF_WORK_PASSTHROUGH.has(raw)) return raw;
  return FIELD_OF_WORK_CROSSWALK[raw] ?? "Other";
}

function buildSegment(rows: Record<string, string>[], key: string, maxValues: number): SegmentMeta {
  const rawCounts = new Map<string, number>();
  for (const row of rows) {
    const raw = (row[key] ?? "").trim();
    const value = raw === "" ? NOT_STATED_VALUE : raw;
    rawCounts.set(value, (rawCounts.get(value) ?? 0) + 1);
  }

  const rawOrdinary: CountEntry[] = [...rawCounts.entries()].filter(([value]) => !isPinned(value));
  const pinnedPresent = PINNED_VALUES.filter((value) => rawCounts.has(value));

  const rawSorted = sortOrdinary(key, rawOrdinary);
  const rawValues = [...rawSorted.map(([value]) => value), ...pinnedPresent];

  let displayEntries: CountEntry[];
  if (key === "FIELD_OF_WORK") {
    const displayCounts = new Map<string, number>();
    for (const [raw, count] of rawOrdinary) {
      const display = fieldOfWorkDisplayValue(raw);
      displayCounts.set(display, (displayCounts.get(display) ?? 0) + count);
    }
    displayEntries = [...displayCounts.entries()].sort((a, b) => b[1] - a[1]);
  } else if (DISPLAY_VALUE_MAPS[key]) {
    const displayCounts = new Map<string, number>();
    for (const [raw, count] of rawOrdinary) {
      const display = DISPLAY_VALUE_MAPS[key][raw] ?? raw;
      displayCounts.set(display, (displayCounts.get(display) ?? 0) + count);
    }
    displayEntries = foldLongTail([...displayCounts.entries()].sort((a, b) => b[1] - a[1]), maxValues);
  } else {
    displayEntries = foldLongTail(rawSorted, maxValues);
  }

  return {
    key,
    label: SEGMENT_LABELS[key] ?? key,
    values: [...displayEntries.map(([value]) => value), ...pinnedPresent],
    rawValues,
  };
}

export function buildSegments(
  rows: Record<string, string>[],
  keys: readonly string[],
  maxValues = 10,
): SegmentMeta[] {
  return keys.map((key) => buildSegment(rows, key, maxValues));
}

// "needs_judgment" only ever appears when s12 falls back to s03's
// deterministic pass (s04/status-final.jsonl absent) — s04 always resolves it
// to either "substantive" or "nonanswer" before writing status-final.jsonl.
export const STATUSES = ["substantive", "nonanswer", "refused", "blank", "needs_judgment"] as const;
export type StatusValue = (typeof STATUSES)[number];

export interface QuestionRef {
  id: string;
  column: string;
}

export interface ThemeMeta {
  code: string;
  label: string;
  /** The question this theme is filed under in the codebook — not
   * necessarily where every label carrying it was actually assigned; see
   * buildThemeIndex's cross-field-bleed handling. */
  home: string;
}

interface CodebookLike {
  questions: { id: string; column: string; themes: { code: string; label: string }[] }[];
}

interface LabelLike {
  id: string;
  /** The question id the label was assigned against (labels.jsonl's own
   * "field" values are question ids like "personal", not CSV column names,
   * despite classify.ts's Label type declaring `field: Column` — the model
   * keyed off the "### personal — ..." system-prompt headers, not the
   * "[PERSONAL_AI_IMPACT]" column tags in the user turn). May differ from
   * the theme's codebook-declared home question (cross-field bleed), which
   * is exactly why this is tracked per question rather than folded into one
   * global list. */
  field: string;
  code: string;
}

export interface ThemeIndex {
  /** One flat, globally-indexed dictionary of every theme in the codebook,
   * in codebook order. Indices into this array are what `themesByRespondent`
   * and `themeCounts` reference. */
  themes: ThemeMeta[];
  /** Per respondent, one array of theme indices per question (parallel to
   * `questions`) — not one merged list, so a theme assigned on a question
   * other than its home question still shows up where it was actually
   * raised. */
  themesByRespondent: Map<string, number[][]>;
  /** questionId -> theme index -> count of distinct respondents who raised
   * that theme on that question. */
  themeCounts: Record<string, number[]>;
  /** questionId -> substantive-respondent count, the denominator a theme's
   * share on that question should be read against. */
  themeDenominators: Record<string, number>;
}

/**
 * Builds the flat theme dictionary and per-respondent/per-question theme
 * indices the viz needs to highlight a theme without recomputing anything
 * client-side. Labels are bucketed by the column they were actually
 * assigned against (`field`), not a theme's codebook "home" question, so
 * cross-field bleed (config.ts's classify rule) survives the export.
 */
export function buildThemeIndex(
  codebook: CodebookLike,
  labels: LabelLike[],
  questions: readonly QuestionRef[],
  ids: string[],
  statusById: Record<string, Record<string, string>>,
): ThemeIndex {
  const themes: ThemeMeta[] = [];
  const themeIndexByCode = new Map<string, number>();
  for (const q of codebook.questions) {
    for (const t of q.themes) {
      themeIndexByCode.set(t.code, themes.length);
      themes.push({ code: t.code, label: t.label, home: q.id });
    }
  }

  const questionIndexById = new Map(questions.map((q, i) => [q.id, i]));

  const themesByRespondent = new Map<string, number[][]>();
  for (const id of ids) themesByRespondent.set(id, questions.map(() => []));

  for (const label of labels) {
    const questionIdx = questionIndexById.get(label.field);
    const themeIdx = themeIndexByCode.get(label.code);
    const perQuestion = themesByRespondent.get(label.id);
    if (questionIdx === undefined || themeIdx === undefined || !perQuestion) continue;
    perQuestion[questionIdx].push(themeIdx);
  }

  const themeCounts: Record<string, number[]> = {};
  for (const q of questions) themeCounts[q.id] = new Array(themes.length).fill(0);
  for (const perQuestion of themesByRespondent.values()) {
    questions.forEach((q, qi) => {
      for (const themeIdx of perQuestion[qi]) themeCounts[q.id][themeIdx]++;
    });
  }

  const themeDenominators: Record<string, number> = {};
  for (const q of questions) {
    themeDenominators[q.id] = ids.filter((id) => statusById[id]?.[q.id] === "substantive").length;
  }

  return { themes, themesByRespondent, themeCounts, themeDenominators };
}

export interface EncodedRespondent {
  id: string;
  seg: number[];
  rawSeg: number[];
  status: number[];
  len: number[];
  /** One array of theme indices per question, parallel to `questions` —
   * empty arrays throughout when no ThemeIndex was supplied (pre-Step-6 /
   * pre-classification export). */
  themes: number[][];
}

export interface EncodedData {
  meta: {
    segments: SegmentMeta[];
    questions: QuestionRef[];
    statuses: readonly string[];
    statusCounts: Record<string, number[]>;
    themes: ThemeMeta[];
    themeCounts: Record<string, number[]>;
    themeDenominators: Record<string, number>;
  };
  respondents: EncodedRespondent[];
}

/**
 * Index-encode respondents against the segment and status dictionaries.
 * `statusById` maps IDEA_ID -> questionId -> status string; a missing
 * entry (id/question pair absent from status-final.jsonl) falls back to
 * "blank" rather than throwing, since s04 only emits rows it has an
 * opinion about.
 */
export function encodeRespondents(
  rows: Record<string, string>[],
  segments: SegmentMeta[],
  questions: readonly QuestionRef[],
  statusById: Record<string, Record<string, string>>,
  idColumn: string,
  themeIndex?: ThemeIndex,
): EncodedData {
  const statusIndex = new Map(STATUSES.map((s, i) => [s, i]));
  const statusCounts: Record<string, number[]> = {};
  for (const q of questions) statusCounts[q.id] = STATUSES.map(() => 0);

  const respondents: EncodedRespondent[] = rows.map((row) => {
    const id = row[idColumn];

    const seg = segments.map((segment) => {
      const raw = (row[segment.key] ?? "").trim();
      const value = raw === "" ? NOT_STATED_VALUE : raw;
      const display =
        segment.key === "FIELD_OF_WORK"
          ? fieldOfWorkDisplayValue(value)
          : (DISPLAY_VALUE_MAPS[segment.key] && !isPinned(value) ? DISPLAY_VALUE_MAPS[segment.key][value] : undefined) ?? value;
      const idx = segment.values.indexOf(display);
      // Value folded into "+N more" or otherwise not a literal match falls
      // back to whichever value that fold bucket became.
      if (idx !== -1) return idx;
      const otherIdx = segment.values.findIndex((v) => v.startsWith("+"));
      return otherIdx === -1 ? 0 : otherIdx;
    });

    const rawSeg = segments.map((segment) => {
      const raw = (row[segment.key] ?? "").trim();
      const value = raw === "" ? NOT_STATED_VALUE : raw;
      const idx = segment.rawValues.indexOf(value);
      return idx === -1 ? 0 : idx; // rawValues is exhaustive; -1 should never happen
    });

    const status = questions.map((q) => {
      const raw = statusById[id]?.[q.id];
      const idx = statusIndex.get(raw as StatusValue) ?? statusIndex.get("blank")!;
      statusCounts[q.id][idx]++;
      return idx;
    });

    const len = questions.map((q) => (row[q.column] ?? "").length);

    const themes = themeIndex?.themesByRespondent.get(id) ?? questions.map(() => []);

    return { id, seg, rawSeg, status, len, themes };
  });

  return {
    meta: {
      segments,
      questions: [...questions],
      statuses: STATUSES,
      statusCounts,
      themes: themeIndex?.themes ?? [],
      themeCounts: themeIndex?.themeCounts ?? Object.fromEntries(questions.map((q) => [q.id, []])),
      themeDenominators: themeIndex?.themeDenominators ?? Object.fromEntries(questions.map((q) => [q.id, 0])),
    },
    respondents,
  };
}
