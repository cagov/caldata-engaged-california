import { wilson } from "./stats.ts";
import type { Codebook } from "./codebook.ts";

const NOT_STATED_VALUE = "(not stated)";

export interface LabelRecord {
  id: string;
  field: string;
  code: string;
}

export interface StatusRecord {
  id: string;
  question: string;
  status: string;
}

export interface DupCluster {
  clusterId: number;
  ids: string[];
}

export interface AggregateOptions {
  codebook: Codebook;
  labels: LabelRecord[];
  statuses: StatusRecord[];
  /** Keyed by question id — matches s10-dups.ts's dup-clusters.json shape. */
  dupClusters: Record<string, DupCluster[]>;
  /** CLEAN_CSV rows; only IDEA_ID + the demographic columns are read. */
  demographicRows: Record<string, string>[];
  idColumn: string;
  demoColumns: readonly string[];
  segmentLabels: Record<string, string>;
  model: string;
  sampleCaveat: string;
  multiLabelNote: string;
  truncationCaveat?: string;
  suppressBelow: number;
  flagBelow: number;
}

export interface ThemePrevalence {
  code: string;
  label: string;
  count: number;
  share: number;
  ciLow: number;
  ciHigh: number;
  countExclDups: number;
  respondentIds: string[];
  /** Carried from the codebook's own audit metadata, when present — see
   * ThemeSchema in codebook.ts. "needs_verification" means the theme was
   * proposed by a discovery pass but never backed by a citable quote; its
   * count should be confirmed against verbatims before publication. */
  verification?: "supported" | "needs_verification";
}

export interface QuestionCounts {
  total: number;
  substantive: number;
  blank: number;
  refused: number;
  nonanswer: number;
}

export interface SegmentThemeStat {
  code: string;
  count: number;
  share: number;
  ciLow: number;
  ciHigh: number;
}

export interface SegmentValueStats {
  n: number;
  suppressed: boolean;
  wideUncertainty: boolean;
  themes?: SegmentThemeStat[];
}

export interface SegmentStats {
  key: string;
  label: string;
  values: Record<string, SegmentValueStats>;
}

export interface QuestionPrevalence {
  id: string;
  prompt: string;
  counts: QuestionCounts;
  themes: ThemePrevalence[];
  segments: SegmentStats[];
}

export interface PersonLevelThemeCount {
  code: string;
  label: string;
  respondentCount: number;
}

export interface PrevalenceData {
  meta: {
    codebookVersion: string;
    model: string;
    generated: string;
    sampleCaveat: string;
    multiLabelNote: string;
    truncationCaveat?: string;
  };
  questions: QuestionPrevalence[];
  personLevel: PersonLevelThemeCount[];
}

function demoValue(row: Record<string, string>, column: string): string {
  const raw = (row[column] ?? "").trim();
  return raw === "" ? NOT_STATED_VALUE : raw;
}

/**
 * Aggregates frozen labels + status + dup-cluster artifacts into prevalence
 * numbers. Pure — no file I/O; the stage handles reading inputs and
 * rendering the report.
 *
 * Cross-field bleed: classification assigns a code to whichever field it
 * actually appears in, even when that differs from the theme's home
 * question (config.ts's cross-field-bleed rule). A theme's per-question
 * `count`/`share` here only counts a respondent if the code was assigned
 * specifically on THAT question's own field — bleed onto a different
 * field is excluded from every per-question numerator (and from segment
 * cells, which use the same per-question rule) — so both the numerator and
 * the denominator (that question's substantive count) always describe the
 * same population. `personLevel`, below, is the one place bleed is still
 * pooled across all fields: it has no per-question denominator to protect,
 * and its purpose is exactly to say "this person raised this theme
 * somewhere", regardless of which question prompted it.
 *
 * (Before 2026-08-29 this pooled all fields into the per-question numerator
 * too, which could push a share above what its own denominator implied —
 * see analysis/CHANGELOG.md.)
 *
 * Near-dup collapsing: `countExclDups` collapses each dup cluster *for
 * that theme's home question* to one representative — cluster membership
 * is itself scoped to respondents who substantively answered the home
 * question, which now lines up with the per-field respondent set above.
 */
export function aggregate(opts: AggregateOptions): PrevalenceData {
  const { codebook, labels, statuses, dupClusters, demographicRows, idColumn, demoColumns, segmentLabels } = opts;

  const statusById = new Map<string, Map<string, string>>();
  for (const rec of statuses) {
    if (!statusById.has(rec.id)) statusById.set(rec.id, new Map());
    statusById.get(rec.id)!.set(rec.question, rec.status);
  }

  // Every distinct respondent who carries each code, anywhere — feeds only
  // personLevel below, which has no per-question denominator to protect.
  const respondentsByCode = new Map<string, Set<string>>();
  for (const label of labels) {
    if (!respondentsByCode.has(label.code)) respondentsByCode.set(label.code, new Set());
    respondentsByCode.get(label.code)!.add(label.id);
  }

  // Every distinct respondent who carries each code specifically on the
  // field matching a given question id — feeds per-question theme counts
  // and segment cells, so bleed from a different field never inflates a
  // numerator whose denominator is anchored to this question alone.
  const respondentsByCodeAndQuestion = new Map<string, Map<string, Set<string>>>();
  for (const label of labels) {
    if (!respondentsByCodeAndQuestion.has(label.field)) respondentsByCodeAndQuestion.set(label.field, new Map());
    const byCode = respondentsByCodeAndQuestion.get(label.field)!;
    if (!byCode.has(label.code)) byCode.set(label.code, new Set());
    byCode.get(label.code)!.add(label.id);
  }

  const themeLabelByCode = new Map<string, string>();
  for (const q of codebook.questions) {
    for (const t of q.themes) themeLabelByCode.set(t.code, t.label);
  }

  // One representative per near-dup cluster, per question.
  const representativeByQuestion = new Map<string, Map<string, string>>();
  for (const [questionId, clusters] of Object.entries(dupClusters)) {
    const rep = new Map<string, string>();
    for (const cluster of clusters) {
      const [first, ...rest] = cluster.ids;
      for (const id of rest) rep.set(id, first);
    }
    representativeByQuestion.set(questionId, rep);
  }

  function dedupedCount(questionId: string, respondentIds: Set<string>): number {
    const rep = representativeByQuestion.get(questionId);
    if (!rep) return respondentIds.size;
    const collapsed = new Set<string>();
    for (const id of respondentIds) collapsed.add(rep.get(id) ?? id);
    return collapsed.size;
  }

  const questions: QuestionPrevalence[] = codebook.questions.map((q) => {
    const statusValues = demographicRows.map((row) => statusById.get(row[idColumn])?.get(q.id) ?? "blank");
    const counts: QuestionCounts = {
      total: statusValues.length,
      substantive: statusValues.filter((s) => s === "substantive").length,
      blank: statusValues.filter((s) => s === "blank").length,
      refused: statusValues.filter((s) => s === "refused").length,
      nonanswer: statusValues.filter((s) => s === "nonanswer").length,
    };

    const substantiveIds = new Set(
      demographicRows.filter((row) => statusById.get(row[idColumn])?.get(q.id) === "substantive").map((row) => row[idColumn]),
    );

    const themes: ThemePrevalence[] = q.themes
      .map((t) => {
        const respondentIds = [...(respondentsByCodeAndQuestion.get(q.id)?.get(t.code) ?? new Set())];
        const count = respondentIds.length;
        const denom = counts.substantive;
        const { low, high } = wilson(count, denom);
        return {
          code: t.code,
          label: t.label,
          count,
          share: denom === 0 ? 0 : count / denom,
          ciLow: low,
          ciHigh: high,
          countExclDups: dedupedCount(q.id, new Set(respondentIds)),
          respondentIds,
          ...(t.verification ? { verification: t.verification } : {}),
        };
      })
      .sort((a, b) => b.share - a.share);

    const segments: SegmentStats[] = demoColumns.map((column) => {
      const cellIds = new Map<string, string[]>();
      for (const row of demographicRows) {
        const id = row[idColumn];
        if (!substantiveIds.has(id)) continue;
        const value = demoValue(row, column);
        if (!cellIds.has(value)) cellIds.set(value, []);
        cellIds.get(value)!.push(id);
      }

      const values: Record<string, SegmentValueStats> = {};
      for (const [value, ids] of cellIds) {
        const n = ids.length;
        const suppressed = n < opts.suppressBelow;
        const wideUncertainty = !suppressed && n < opts.flagBelow;
        const idSet = new Set(ids);

        values[value] = {
          n,
          suppressed,
          wideUncertainty,
          themes: suppressed
            ? undefined
            : q.themes
                .map((t) => {
                  const cellCount = [...(respondentsByCodeAndQuestion.get(q.id)?.get(t.code) ?? new Set())].filter((id) =>
                    idSet.has(id),
                  ).length;
                  const { low, high } = wilson(cellCount, n);
                  return { code: t.code, count: cellCount, share: cellCount / n, ciLow: low, ciHigh: high };
                })
                .sort((a, b) => b.share - a.share),
        };
      }

      return { key: column, label: segmentLabels[column] ?? column, values };
    });

    return { id: q.id, prompt: q.prompt, counts, themes, segments };
  });

  const personLevel: PersonLevelThemeCount[] = [...respondentsByCode.entries()]
    .map(([code, ids]) => ({ code, label: themeLabelByCode.get(code) ?? code, respondentCount: ids.size }))
    .sort((a, b) => b.respondentCount - a.respondentCount);

  return {
    meta: {
      codebookVersion: codebook.version,
      model: opts.model,
      generated: new Date().toISOString(),
      sampleCaveat: opts.sampleCaveat,
      multiLabelNote: opts.multiLabelNote,
      ...(opts.truncationCaveat ? { truncationCaveat: opts.truncationCaveat } : {}),
    },
    questions,
    personLevel,
  };
}
