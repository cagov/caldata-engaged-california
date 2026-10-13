import type { Codebook } from "./codebook.ts";
import type { PrevalenceData } from "./aggregate.ts";

export interface ThemeCsvRow {
  survey_question: string;
  theme_code: string;
  theme_label: string;
  theme_description: string;
  verification: "supported" | "needs_verification";
  respondents: number;
  denominator_answered: number;
  pct_of_answered: number;
  denominator_all: number;
  pct_of_all: number;
}

export const CSV_COLUMNS: (keyof ThemeCsvRow)[] = [
  "survey_question",
  "theme_code",
  "theme_label",
  "theme_description",
  "verification",
  "respondents",
  "denominator_answered",
  "pct_of_answered",
  "denominator_all",
  "pct_of_all",
];

/**
 * One-line descriptions, keyed the same as CSV_COLUMNS, so a data dictionary
 * for the CSV can never drift out of sync with the row shape it documents.
 */
export const COLUMN_DICTIONARY: Record<keyof ThemeCsvRow, string> = {
  survey_question: "Verbatim wording of the survey question this theme was coded under (its \"home\" question).",
  theme_code: "Stable codebook identifier for the theme — use this, not theme_label, to join back to labels.jsonl or a future export.",
  theme_label: "Short human-readable name for the theme.",
  theme_description: "The codebook's definition of what the theme covers.",
  verification:
    "\"supported\" or \"needs_verification\". needs_verification means the codebook's own audit found no citable example backing this theme; confirm against verbatims before citing its count.",
  respondents: "Distinct respondents assigned this theme code specifically while answering survey_question (cross-field bleed onto other questions is excluded).",
  denominator_answered: "Respondents who gave a substantive answer to this theme's home question — excludes blank answers and answers judged a non-answer.",
  pct_of_answered: "respondents / denominator_answered, as a percentage to one decimal place.",
  denominator_all: "Total survey respondents (all questions, all answer statuses) — the same value for every theme under a given question.",
  pct_of_all: "respondents / denominator_all, as a percentage to one decimal place.",
};

function pct1(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Joins the codebook (theme definitions, question prompts) against a frozen
 * prevalence.json (counts, denominators) into one flat row per theme, safe to
 * hand to csv-stringify. Pure — no file I/O.
 *
 * The codebook, not prevalence.json, drives the row list: a theme can be in
 * the approved codebook without yet appearing in prevalence.json (e.g. zero
 * respondents raised it, or aggregate hasn't been re-run since a codebook
 * edit) and should still be reported as a theme at 0%, never silently
 * dropped.
 *
 * respondentIds never touch this module's output — only the aggregate
 * counts and shares already computed by lib/aggregate.ts.
 */
export function buildThemeRows(codebook: Codebook, prevalence: PrevalenceData): ThemeCsvRow[] {
  const rows: ThemeCsvRow[] = [];

  for (const q of codebook.questions) {
    const questionPrevalence = prevalence.questions.find((p) => p.id === q.id);
    const denominatorAnswered = questionPrevalence?.counts.substantive ?? 0;
    const denominatorAll = questionPrevalence?.counts.total ?? 0;
    const statByCode = new Map(questionPrevalence?.themes.map((t) => [t.code, t]) ?? []);

    const questionRows = q.themes.map((theme): ThemeCsvRow => {
      const stat = statByCode.get(theme.code);
      const respondents = stat?.count ?? 0;
      return {
        survey_question: q.prompt,
        theme_code: theme.code,
        theme_label: theme.label,
        theme_description: theme.definition,
        // Every theme in the current codebook sets this explicitly; the
        // fallback only guards against a future hand-authored theme that
        // omits it, per ThemeSchema's optionality in codebook.ts.
        verification: theme.verification ?? "supported",
        respondents,
        denominator_answered: denominatorAnswered,
        pct_of_answered: pct1(respondents, denominatorAnswered),
        denominator_all: denominatorAll,
        pct_of_all: pct1(respondents, denominatorAll),
      };
    });

    questionRows.sort((a, b) => b.pct_of_answered - a.pct_of_answered);
    rows.push(...questionRows);
  }

  return rows;
}
