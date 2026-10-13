/**
 * Pure logic for the theme highlight axis: which themes to offer in the
 * picker for a given question, and which respondents match a picked theme.
 * Kept out of App.svelte so both are unit-testable without mounting Svelte.
 */
import type { ThemeMeta } from "./data.ts";

export interface ThemeOption {
  index: number;
  code: string;
  label: string;
  home: string;
  count: number;
  pct: number;
}

/**
 * Scoped to the current question's home themes (the codebook's own
 * per-question list), not every theme with a nonzero count there —
 * cross-field bleed still highlights correctly once picked (a respondent's
 * theme indices are recorded per question actually raised on), it just
 * isn't offered a second time under a question that isn't its declared
 * home. Sorted by count descending so the most prevalent themes lead.
 */
export function buildThemeOptions(
  themes: ThemeMeta[],
  counts: number[],
  denominator: number,
  questionId: string,
): ThemeOption[] {
  return themes
    .map((t, index) => ({ index, code: t.code, label: t.label, home: t.home, count: counts[index] ?? 0 }))
    .filter((t) => t.home === questionId)
    .sort((a, b) => b.count - a.count)
    .map((t) => ({ ...t, pct: denominator > 0 ? Math.round((t.count / denominator) * 100) : 0 }));
}

/**
 * One boolean per respondent (same order as `respondents`) — true if that
 * respondent raised `themeIndex` on `questionIndex`. Returns null when no
 * theme is picked, the "nothing dims" sentinel the chart components check.
 */
export function computeHighlight(
  respondents: { themes: number[][] }[],
  questionIndex: number,
  themeIndex: number | null,
): boolean[] | null {
  if (themeIndex === null) return null;
  return respondents.map((r) => r.themes[questionIndex]?.includes(themeIndex) ?? false);
}
