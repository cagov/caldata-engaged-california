/**
 * Loads the committed inputs. None of them contain respondent data:
 * - inputs/segments.json        survey answer-choice labels and their display grouping
 * - inputs/counties.json        which counties the survey grouped into each region
 * - inputs/phase2-taxonomy.json Phase 2 theme / subtheme / policy-concept ids and public names
 * - inputs/published/*          files published on https://engaged.ca.gov/ai-impact/report/
 * - ../analysis/config/codebook.json and phase-crosswalk.json (theme codes, labels, concept links)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;

export interface SegmentInput {
  key: string;
  label: string;
  values: string[];
  rawValues: string[];
  /** rawValues index -> values index */
  rawToValue: number[];
}

export interface TaxonomyInput {
  themes: { id: string; name: string }[];
  subthemes: { id: string; themeId: string; name: string }[];
  concepts: { id: string; subthemeId: string; themeId: string; name: string }[];
}

export interface PublishedCategory {
  name: string;
  surveyCount: number;
  attendCount: number;
}

export interface PublishedFunnel {
  phase1Total: number;
  regions: PublishedCategory[];
  fieldOfWork: PublishedCategory[];
  age: PublishedCategory[];
  aiResponse: PublishedCategory[];
  race: PublishedCategory[];
  gender: PublishedCategory[];
  sessions: { date: string; attendees: { region: string; fieldOfWork: string }[] }[];
  invitedByRegion: { name: string; count: number }[];
  invitedTotal: number;
}

export interface PublishedQuotes {
  source: string;
  fetched: string;
  quotes: { conceptId: string; text: string; byline: string }[];
}

export interface CodebookTheme {
  code: string;
  label: string;
}

export interface Codebook {
  version: string;
  nonAnswers: string[];
  refusalMarker: string;
  questions: { id: string; themes: CodebookTheme[] }[];
}

export interface PhaseCrosswalk {
  version: string;
  codebookVersion: string;
  status: "proposed" | "approved";
  approvedBy: string | null;
  method: string;
  concepts: {
    conceptId: string;
    sources: { code: string; field: string; strength: "primary" | "secondary" | "tangential"; rationale: string }[];
  }[];
}

export interface Inputs {
  segments: SegmentInput[];
  counties: Record<string, string[]>;
  taxonomy: TaxonomyInput;
  funnel: PublishedFunnel;
  quotes: PublishedQuotes;
  codebook: Codebook;
  crosswalk: PhaseCrosswalk;
}

export function loadInputs(): Inputs {
  return {
    segments: read("inputs/segments.json"),
    counties: read("inputs/counties.json"),
    taxonomy: read("inputs/phase2-taxonomy.json"),
    funnel: read("inputs/published/ai-report-participant-funnel.json"),
    quotes: read("inputs/published/report-quotes.json"),
    codebook: read("../analysis/config/codebook.json"),
    crosswalk: read("../analysis/config/phase-crosswalk.json"),
  };
}
