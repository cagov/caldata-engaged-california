import { PHASE_COLUMN } from "./lib/phase.ts";

export const PIPELINE_MODEL = "claude-opus-5";

// Input data lives outside the repo. EC_DATA_DIR / EC_WORK_DIR let the
// offline stages run against synthetic-data/ instead (see README).
const DATA_DIR = process.env.EC_DATA_DIR ?? "../data";
const WORK_DIR = process.env.EC_WORK_DIR ?? ".";

export const DATA_CSV = `${DATA_DIR}/survey respondent demographics, 2026-08-18-1554.csv`;
export const ATTENDEE_CSV = `${DATA_DIR}/attendee demographics, 2026-08-18-1424.csv`;
// Adds FIELD_OF_WORK_ROLLUP (absent from DATA_CSV above) for the
// participant-funnel-cloud prototype — same respondent population as
// DATA_CSV, just a later export with one more rollup column.
export const DEMOGRAPHICS_ROLLUP_CSV = `${DATA_DIR}/survey respondent demographics 2026-08-28.csv`;
// Real per-region invited counts for the participant-funnel-selection
// prototype's "invited" stage — region-only, no field-of-work breakdown.
export const SORTITION_CSV = `${DATA_DIR}/Sortition Candidates and Attendance Rates.csv`;
export const ROOMS_XLSX = `${DATA_DIR}/Policy ideas with votes (sessions 1-14).xlsx`;
export const POLICY_CONCEPTS_V2_CSV =
  `${DATA_DIR}/Policy ideas with votes (sessions 1-14) - Themes, subthemes, policy concepts-v2.csv`;
export const PHASE_CROSSWALK_PATH = "config/phase-crosswalk.json";
export const CLEAN_CSV = `${WORK_DIR}/data/responses_clean.csv`;
export const ARTIFACTS = `${WORK_DIR}/artifacts`;
export const CORPUS_DIR = `${WORK_DIR}/corpus`;
export const REPORTS_DIR = `${WORK_DIR}/reports`;
export const CODEBOOK_PATH = "config/codebook.json";

export const QUESTIONS = [
  {
    id: "personal",
    column: "PERSONAL_AI_IMPACT",
    prompt: "How has AI impacted your job and workplace, if at all?",
  },
  {
    id: "economy",
    column: "ECONOMIC_IMPACT_EXPECTATION",
    prompt: "How do you expect AI to impact the economy?",
  },
  {
    id: "government",
    column: "GOVERNMENT_ACTION_SUGGESTION",
    prompt: "What do you think the government should do about these impacts?",
  },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type Column = (typeof QUESTIONS)[number]["column"];

export const ID_COLUMN = "SURVEY_RESPONDENT_ID";
export const REFUSAL_MARKER = "i don't want to say";

export const SHORT_CELL_MAX = 60;   // cells ≤ this go to the LLM judgment pass
export const TRUNCATION_LEN = 990;  // ≥ this flags possible 1000-char export cap
export const SUPPRESS_BELOW = 10;   // privacy: cells under this publish n only
export const FLAG_BELOW = 30;       // reliability: cells under this get a wide-uncertainty flag
// A single word swapped in an ~18-word sentence changes ~3 of ~16 3-word
// shingles, capping Jaccard around 0.68 even for a near-verbatim copy — 0.85
// would miss real templated-campaign near-dups. Calibrated against the
// worked example in dups.test.ts; keep both in sync if this changes.
export const NEAR_DUP_JACCARD = 0.6;
export const NEAR_DUP_MIN_LEN = 80;

export const SEGMENTS = [
  "REGION",
  "AGE",
  "GENDER_CATEGORY",
  "RACE_ETHNICITY_CATEGORY",
  "CURRENT_WORK_STATUS",
  "ROLE_AT_WORK",
  "FIELD_OF_WORK",
  "AI_RESPONSE_LABEL",
] as const;

// Viz-only breakdowns. PHASE is deliberately absent from SEGMENTS above:
// s11-aggregate passes SEGMENTS as demoColumns for the published prevalence
// report, and a 101-respondent subgroup would land there under the
// SUPPRESS_BELOW threshold for many theme x Phase cells. Promote it into
// SEGMENTS when that's a decision someone has actually made.
export const VIZ_SEGMENTS = [...SEGMENTS, PHASE_COLUMN] as const;

export const SAMPLE_CAVEAT =
  "Self-selected public consultation, not a probability sample. " +
  "Percentages describe the people who responded, not Californians.";
