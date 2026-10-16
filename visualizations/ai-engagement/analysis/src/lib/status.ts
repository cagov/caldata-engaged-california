import { REFUSAL_MARKER, SHORT_CELL_MAX } from "../config.ts";

export type Status = "blank" | "refused" | "substantive" | "needs_judgment";

export function deterministicStatus(raw: string): Status {
  const v = raw.trim();
  if (v.length === 0) return "blank";
  if (v.toLowerCase() === REFUSAL_MARKER) return "refused";
  if (v.length > SHORT_CELL_MAX) return "substantive";
  return "needs_judgment";
}
