/**
 * Fetches and decodes the export written by `analysis/src/stages/s12-vizdata.ts`.
 * Mirrors that stage's output shape but is intentionally not shared code with
 * analysis/ — viz/ is a standalone app that only ever reads the JSON contract.
 */

export interface SegmentMeta {
  key: string;
  label: string;
  /** Display/grouping dictionary — what the chart axis and blobs use. */
  values: string[];
  /** Every distinct raw survey value, never folded or remapped — use this,
   * not `values`, when showing a specific respondent's true category. */
  rawValues: string[];
}

export interface QuestionMeta {
  id: string;
  column: string;
  prompt: string;
}

export interface ThemeMeta {
  code: string;
  label: string;
  /** The question this theme is filed under in the codebook — not
   * necessarily every question it was actually raised on; see
   * Respondent.themes and themeCounts for cross-field bleed. */
  home: string;
}

export interface RespondentsMeta {
  generated: string;
  sourceHash: string;
  sampleCaveat: string;
  segments: SegmentMeta[];
  questions: QuestionMeta[];
  statuses: string[];
  statusCounts: Record<string, number[]>;
  /** Flat, globally-indexed theme dictionary — indices into this array are
   * what Respondent.themes and themeCounts reference. Empty when
   * classification hasn't run yet; the export always includes the field. */
  themes: ThemeMeta[];
  /** questionId -> theme index -> count of distinct respondents who raised
   * that theme on that question (including cross-field bleed). */
  themeCounts: Record<string, number[]>;
  /** questionId -> substantive-respondent count, the denominator a theme's
   * share on that question should be read against. */
  themeDenominators: Record<string, number>;
}

export interface Respondent {
  id: string;
  seg: number[];
  rawSeg: number[];
  status: number[];
  len: number[];
  /** One array of theme indices per question, parallel to meta.questions —
   * empty arrays throughout when classification hasn't run yet. */
  themes: number[][];
}

export interface RespondentsData {
  meta: RespondentsMeta;
  respondents: Respondent[];
}

export class DataNotFoundError extends Error {
  constructor() {
    super("No export found — run `npm run vizdata` in analysis/ first.");
    this.name = "DataNotFoundError";
  }
}

export async function fetchRespondents(): Promise<RespondentsData> {
  const res = await fetch("/respondents.json");
  if (res.status === 404) throw new DataNotFoundError();
  if (!res.ok) throw new Error(`Failed to load respondents.json: ${res.status}`);
  return res.json();
}

const verbatimCache = new Map<string, Promise<Record<string, string>>>();

export function fetchVerbatims(questionId: string): Promise<Record<string, string>> {
  let pending = verbatimCache.get(questionId);
  if (!pending) {
    pending = fetch(`/verbatims.${questionId}.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load verbatims.${questionId}.json: ${res.status}`);
      return res.json();
    });
    verbatimCache.set(questionId, pending);
  }
  return pending;
}
