import type { SegmentMeta, QuestionRef, ThemeMeta, EncodedRespondent } from "./vizdata.ts";

/** The on-disk shape of artifacts/viz/respondents.json — only the fields
 * needed to decode a respondent's index arrays back into key/value form. */
export interface RespondentsJson {
  meta: {
    segments: SegmentMeta[];
    questions: QuestionRef[];
    statuses: readonly string[];
    themes: ThemeMeta[];
  };
  respondents: EncodedRespondent[];
}

export interface ReadableRespondent {
  id: string;
  /** Segment key -> display value (folded/remapped — what the app charts). */
  segments: Record<string, string>;
  /** Segment key -> true survey value, never folded or remapped. */
  rawSegments: Record<string, string>;
  /** Question id -> status ("substantive" | "blank" | "refused" | ...). */
  status: Record<string, string>;
  /** Question id -> answer character length. */
  length: Record<string, number>;
  /** Question id -> theme codes raised on that question. */
  themes: Record<string, string[]>;
}

/**
 * Expands respondents.json's index-encoded arrays into keyed objects, using
 * only the dictionaries already present in the file's own meta block — no
 * other pipeline artifact required. Pure — no file I/O.
 */
export function toReadableRespondents(data: RespondentsJson): ReadableRespondent[] {
  const { segments, questions, statuses, themes } = data.meta;

  return data.respondents.map((r): ReadableRespondent => {
    const segmentsOut: Record<string, string> = {};
    const rawSegmentsOut: Record<string, string> = {};
    segments.forEach((segment, i) => {
      segmentsOut[segment.key] = segment.values[r.seg[i]];
      rawSegmentsOut[segment.key] = segment.rawValues[r.rawSeg[i]];
    });

    const status: Record<string, string> = {};
    const length: Record<string, number> = {};
    const themesOut: Record<string, string[]> = {};
    questions.forEach((q, i) => {
      status[q.id] = statuses[r.status[i]];
      length[q.id] = r.len[i];
      themesOut[q.id] = (r.themes[i] ?? []).map((themeIdx) => themes[themeIdx].code);
    });

    return { id: r.id, segments: segmentsOut, rawSegments: rawSegmentsOut, status, length, themes: themesOut };
  });
}
