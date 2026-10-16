/**
 * Fake Phase 1 survey respondents. Demographics are drawn independently from
 * the published per-category totals (so no real cross-tabulation is
 * reproduced); every free-text answer is templated from codebook theme labels
 * and starts with "[SYNTHETIC]".
 */
import type { Respondent, RespondentsData } from "../../viz/src/lib/data.ts";
import type { Inputs, PublishedCategory, SegmentInput } from "./inputs.ts";
import { int, pick, shuffle, uuid, weighted, weightedDistinct, type Rng } from "./rng.ts";

export const QUESTIONS = [
  { id: "personal", column: "PERSONAL_AI_IMPACT", prompt: "How has AI impacted your job and workplace, if at all?" },
  { id: "economy", column: "ECONOMIC_IMPACT_EXPECTATION", prompt: "How do you expect AI to impact the economy?" },
  { id: "government", column: "GOVERNMENT_ACTION_SUGGESTION", prompt: "What do you think the government should do about these impacts?" },
] as const;

/** Same order as analysis/ (s03-status.ts): index = Respondent.status value. */
export const STATUSES = ["substantive", "nonanswer", "refused", "blank", "needs_judgment"];
const STATUS_WEIGHTS = [0.868, 0.024, 0.008, 0.1, 0];

export const SYNTHETIC_PREFIX = "[SYNTHETIC] ";
export const ANSWER_CAP = 1000; // the real export truncates every free-text field here
export const SAMPLE_CAVEAT =
  "SYNTHETIC DATA — not real responses. (Real caveat: self-selected public consultation, not a probability sample. Percentages describe the people who responded, not Californians.)";

const NOT_STATED = "(not stated)";
const REFUSED_CHOICE = "I don't want to say";
const NOT_WORKING = "I don't currently work";
const WORKING = "Yes, I currently work";

/** Relative weights for segments the site doesn't publish totals for. */
const HAND_WEIGHTS: Record<string, Record<string, number>> = {
  CURRENT_WORK_STATUS: {
    [WORKING]: 72,
    "No, I don't currently work but I'm looking for work": 7,
    "No, I'm retired or choose not to work": 13,
    [NOT_STATED]: 6,
    [REFUSED_CHOICE]: 2,
  },
  ROLE_AT_WORK: {
    "Employee (non-management)": 55,
    Manager: 18,
    "Executive or leader": 8,
    "Contractor, freelancer, or gig worker": 9,
    "Business owner or entrepreneur": 7,
    [NOT_STATED]: 2,
    [REFUSED_CHOICE]: 1,
  },
  FIELD_OF_WORK: {
    Government: 16, "Information technology": 12, "Arts, entertainment, or media": 8, Other: 12,
    Education: 9, Healthcare: 7, "Non-profit": 5, "Retail or wholesale trade": 3,
    "Architecture or engineering": 4, Finance: 4, Science: 3, Legal: 2,
    "Transportation or warehousing": 2, Construction: 2, Manufacturing: 2, Hospitality: 1.5,
    "Real estate or leasing": 1, "Agriculture, forestry, or fishing": 1, Insurance: 1,
    "Utilities or waste management": 1, "Corporate ownership or governance": 0.5,
    "Mining, quarrying, or oil and gas extraction": 0.3, [NOT_STATED]: 2, [REFUSED_CHOICE]: 1,
  },
};

const PUBLISHED_FOR: Record<string, keyof Inputs["funnel"]> = {
  REGION: "regions",
  AGE: "age",
  GENDER_CATEGORY: "gender",
  RACE_ETHNICITY_CATEGORY: "race",
  AI_RESPONSE_LABEL: "aiResponse",
};

/** Per-rawValue weights: published survey totals split evenly across the raw values
 * that fold into each display value; small fallback for anything unpublished. */
export function segmentWeights(seg: SegmentInput, inputs: Inputs): number[] {
  const hand = HAND_WEIGHTS[seg.key];
  if (hand) return seg.rawValues.map((v) => hand[v] ?? 0);
  const key = PUBLISHED_FOR[seg.key];
  const pub = key ? (inputs.funnel[key] as PublishedCategory[]) : [];
  const byName = new Map(pub.map((c) => [c.name, c.surveyCount]));
  const total = pub.reduce((a, c) => a + c.surveyCount, 0) || seg.rawValues.length;
  const shares = seg.rawToValue.map((v) => seg.rawToValue.filter((x) => x === v).length);
  return seg.rawValues.map((_, j) => {
    const count = byName.get(seg.values[seg.rawToValue[j]]);
    return count !== undefined ? count / shares[j] : total * 0.01;
  });
}

export interface FakeRespondent {
  id: string;
  /** One rawValues index per segment, parallel to inputs.segments. */
  rawSeg: number[];
  /** One STATUSES index per question, parallel to QUESTIONS. */
  status: number[];
  text: string[];
  /** Indices into the flat codebook theme list, per question. */
  themes: number[][];
}

export interface FlatTheme {
  code: string;
  label: string;
  home: string;
}

export function flatThemes(inputs: Inputs): FlatTheme[] {
  return inputs.codebook.questions.flatMap((q) => q.themes.map((t) => ({ code: t.code, label: t.label, home: q.id })));
}

const TEMPLATES: Record<string, string[]> = {
  personal: [
    "At work the main change has been {t}.",
    "I'd sum it up as {t}.",
    "Mostly {t}, at least on my team.",
    "What I notice day to day is {t}.",
  ],
  economy: [
    "I expect {t}.",
    "Probably {t}, at least at first.",
    "My biggest worry is {t}.",
    "Over the next few years I think we'll see {t}.",
  ],
  government: [
    "The state should focus on {t}.",
    "Please prioritize {t}.",
    "Government action should address {t}.",
    "I'd like to see a plan for {t}.",
  ],
};

const FILLERS = [
  "This answer was generated for testing and is not from a real person.",
  "It depends a lot on the kind of work.",
  "Hard to say how quickly this will happen.",
  "Some of this is already happening where I live.",
  "I have mixed feelings about it overall.",
  "Other people I know see it differently.",
  "It's too early to tell what the long-term effect will be.",
];

function lowerFirst(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

export function syntheticAnswer(rng: Rng, questionId: string, themeLabels: string[]): string {
  const sentences = themeLabels.map((l) => pick(rng, TEMPLATES[questionId]).replace("{t}", lowerFirst(l)));
  if (sentences.length === 0) sentences.push(pick(rng, FILLERS));
  for (let i = int(rng, 0, 2); i > 0; i--) sentences.push(pick(rng, FILLERS));
  let text = SYNTHETIC_PREFIX + sentences.join(rng() < 0.03 ? "\n\n" : " ");
  if (rng() < 0.04) {
    // Mimic the export's hard 1,000-character cap, cutting mid-word.
    while (text.length <= ANSWER_CAP) text += " " + pick(rng, FILLERS);
    text = text.slice(0, ANSWER_CAP);
  }
  return text;
}

export function makeRespondents(rng: Rng, inputs: Inputs): FakeRespondent[] {
  const segs = inputs.segments;
  const segIndex = (key: string) => segs.findIndex((s) => s.key === key);
  const weights = segs.map((s) => segmentWeights(s, inputs));
  const themes = flatThemes(inputs);

  // Theme popularity: a seeded Zipf-like ranking within each home question.
  const popularity = new Array<number>(themes.length).fill(0);
  for (const q of QUESTIONS) {
    const idx = themes.map((t, i) => (t.home === q.id ? i : -1)).filter((i) => i >= 0);
    shuffle(rng, idx).forEach((ti, rank) => (popularity[ti] = 1 / Math.pow(rank + 1, 0.8)));
  }

  const iWork = segIndex("CURRENT_WORK_STATUS");
  const iRole = segIndex("ROLE_AT_WORK");
  const iField = segIndex("FIELD_OF_WORK");
  const iPhase = segIndex("PHASE");
  const notWorking = (s: SegmentInput, name: string) => s.rawValues.indexOf(name);

  const people: FakeRespondent[] = [];
  for (let n = 0; n < inputs.funnel.phase1Total; n++) {
    const rawSeg = segs.map((s, i) => (i === iPhase ? 0 : weighted(rng, weights[i])));
    // Keep role/field consistent with work status, like the real form's skip logic.
    if (segs[iWork].rawValues[rawSeg[iWork]] !== WORKING && rng() < 0.9) {
      rawSeg[iRole] = notWorking(segs[iRole], NOT_WORKING);
      rawSeg[iField] = notWorking(segs[iField], NOT_WORKING);
    }
    const status: number[] = [];
    const text: string[] = [];
    const theirThemes: number[][] = [];
    for (const q of QUESTIONS) {
      const st = weighted(rng, STATUS_WEIGHTS);
      let picked: number[] = [];
      let t = "";
      if (st === 0) {
        const k = 1 + weighted(rng, [0.3, 0.35, 0.25, 0.1]);
        const w = popularity.map((p, i) => (themes[i].home === q.id ? p : 0));
        picked = weightedDistinct(rng, w, k);
        if (rng() < 0.03) {
          // ~1% of theme mentions are cross-field bleed (a theme filed under another question).
          const other = popularity.map((p, i) => (themes[i].home !== q.id ? p : 0));
          picked.push(weighted(rng, other));
        }
        t = syntheticAnswer(rng, q.id, picked.map((i) => themes[i].label));
      } else if (st === 1) {
        t = pick(rng, inputs.codebook.nonAnswers);
      } else if (st === 2) {
        t = inputs.codebook.refusalMarker;
      }
      status.push(st);
      text.push(t);
      theirThemes.push(picked);
    }
    people.push({ id: uuid(rng), rawSeg, status, text, themes: theirThemes });
  }

  // Phase 2: one synthetic respondent per published discussion attendee, matched on region.
  const iRegion = segIndex("REGION");
  const pool = shuffle(rng, people.map((_, i) => i));
  for (const session of inputs.funnel.sessions) {
    for (const a of session.attendees) {
      const region = segs[iRegion].rawValues.indexOf(a.region);
      const at = pool.findIndex((i) => people[i].rawSeg[iRegion] === region || region < 0);
      const chosen = pool.splice(at >= 0 ? at : 0, 1)[0];
      people[chosen].rawSeg[iPhase] = 1;
    }
  }
  return people;
}

export function respondentsJson(people: FakeRespondent[], inputs: Inputs, generated: string, seed: number): RespondentsData {
  const themes = flatThemes(inputs);
  const themeCounts: Record<string, number[]> = {};
  const statusCounts: Record<string, number[]> = {};
  const themeDenominators: Record<string, number> = {};
  QUESTIONS.forEach((q, qi) => {
    themeCounts[q.id] = themes.map(() => 0);
    statusCounts[q.id] = STATUSES.map(() => 0);
    for (const p of people) {
      statusCounts[q.id][p.status[qi]]++;
      for (const t of p.themes[qi]) themeCounts[q.id][t]++;
    }
    themeDenominators[q.id] = statusCounts[q.id][0];
  });
  const respondents: Respondent[] = people.map((p) => ({
    id: p.id,
    seg: p.rawSeg.map((r, i) => inputs.segments[i].rawToValue[r]),
    rawSeg: p.rawSeg,
    status: p.status,
    len: p.text.map((t) => t.length),
    themes: p.themes,
  }));
  return {
    meta: {
      generated,
      sourceHash: `synthetic:seed=${seed}`,
      sampleCaveat: SAMPLE_CAVEAT,
      segments: inputs.segments.map(({ key, label, values, rawValues }) => ({ key, label, values, rawValues })),
      questions: QUESTIONS.map((q) => ({ ...q })),
      statuses: STATUSES,
      statusCounts,
      themes,
      themeCounts,
      themeDenominators,
    },
    respondents,
  };
}

/** questionId -> { respondentId: answer } for every non-blank answer. */
export function verbatimsJson(people: FakeRespondent[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  QUESTIONS.forEach((q, qi) => {
    out[q.id] = {};
    for (const p of people) if (p.text[qi] !== "") out[q.id][p.id] = p.text[qi];
  });
  return out;
}

/** Header of analysis/'s DATA_CSV (the survey respondent demographics export). */
export const SURVEY_CSV_HEADER = [
  "SURVEY_RESPONDENT_ID", "AGE", "GENDER_ARRAY", "GENDER_CATEGORY", "RACE_ETHNICITY_ARRAY",
  "RACE_ETHNICITY_CATEGORY", "CURRENT_WORK_STATUS", "ROLE_AT_WORK", "COUNTY", "REGION",
  "FIELD_OF_WORK", "ECONOMIC_IMPACT_EXPECTATION", "GOVERNMENT_ACTION_SUGGESTION",
  "PERSONAL_AI_IMPACT", "AI_RESPONSE_LABEL",
] as const;

const MULTI_SEGMENTS = ["GENDER_CATEGORY", "RACE_ETHNICITY_CATEGORY"];
const OUTSIDE_REGION_COUNTY = ["I M Not Sure", "I don't want to say", "I live outside of California", ""];

/** Raw export rows in the same encoding as the real file. */
export function surveyCsvRows(rng: Rng, people: FakeRespondent[], inputs: Inputs): Record<string, string>[] {
  const segs = inputs.segments;
  return people.map((p) => {
    const row: Record<string, string> = { SURVEY_RESPONDENT_ID: p.id };
    segs.forEach((s, i) => {
      if (s.key === "PHASE") return;
      const raw = s.rawValues[p.rawSeg[i]];
      if (!MULTI_SEGMENTS.includes(s.key)) {
        row[s.key] = raw === NOT_STATED ? "" : raw;
        return;
      }
      const singles = s.rawValues.filter((v) => v !== NOT_STATED && v !== "Multiple");
      const arrayKey = s.key.replace("_CATEGORY", "_ARRAY");
      if (raw === NOT_STATED) {
        row[s.key] = row[arrayKey] = "";
      } else if (raw === "Multiple") {
        const choices = shuffle(rng, singles.filter((v) => v !== REFUSED_CHOICE)).slice(0, 2);
        row[s.key] = "Multiple";
        row[arrayKey] = JSON.stringify(choices, null, 2);
      } else {
        row[s.key] = `${raw} (only)`;
        row[arrayKey] = JSON.stringify([raw], null, 2);
      }
    });
    const region = row.REGION;
    row.COUNTY = region ? pick(rng, inputs.counties[region] ?? [""]) : pick(rng, OUTSIDE_REGION_COUNTY);
    QUESTIONS.forEach((q, qi) => (row[q.column] = p.text[qi]));
    return row;
  });
}
