import { QUESTIONS, ID_COLUMN, TRUNCATION_LEN } from "../config.ts";

export type AuditResult = {
  rowCount: number;
  duplicateIds: string[];
  perQuestion: { column: string; filled: number; medianLen: number; maxLen: number; truncationSuspects: number }[];
};

export function auditRows(rows: Record<string, string>[]): AuditResult {
  const ids = rows.map((r) => (r[ID_COLUMN] ?? "").trim());
  const seen = new Set<string>();
  const duplicateIds = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));

  const perQuestion = QUESTIONS.map((q) => {
    const lens = rows
      .map((r) => (r[q.column] ?? "").trim().length)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    return {
      column: q.column,
      filled: lens.length,
      medianLen: lens.length ? lens[Math.floor(lens.length / 2)] : 0,
      maxLen: lens.at(-1) ?? 0,
      truncationSuspects: lens.filter((n) => n >= TRUNCATION_LEN).length,
    };
  });
  return { rowCount: rows.length, duplicateIds, perQuestion };
}
