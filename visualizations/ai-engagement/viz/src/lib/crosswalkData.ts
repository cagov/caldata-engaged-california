/**
 * Fetches and decodes the export written by
 * `analysis/src/stages/s15-crosswalk.ts` (the Phase 1 -> Phase 2 concept
 * crosswalk). Mirrors roomsData.ts's fetchRooms/RoomsNotFoundError shape —
 * viz/ shares no code with analysis/, it only ever reads the JSON contract.
 */

export type Strength = "primary" | "secondary" | "tangential";

export interface CrosswalkMeta {
  generated: string;
  version: string;
  codebookVersion: string;
  roomsSourceHash: string;
  status: "proposed" | "approved";
  approvedBy: string | null;
  method: string;
  caveat: string;
}

export interface CrosswalkTheme {
  code: string;
  label: string;
  /** The codebook's declared home question for this theme — "personal" |
   * "economy" | "government". Used for the 112-vs-72 scope filter. */
  home: string;
  counts: { personal: number; economy: number; government: number };
}

export interface CrosswalkEdge {
  conceptId: string;
  code: string;
  field: string;
  strength: Strength;
  rationale: string;
}

export interface CrosswalkConceptMetrics {
  conceptId: string;
  sessionsPct: number;
  topPct: number;
  voteToIdeaRatio: number;
  compositePctSum: number;
  compositeCountSum: number;
}

export interface CrosswalkData {
  meta: CrosswalkMeta;
  themes: CrosswalkTheme[];
  edges: CrosswalkEdge[];
  unclaimedCodes: string[];
  concepts: CrosswalkConceptMetrics[];
}

export class CrosswalkNotFoundError extends Error {
  constructor() {
    super("No export found — run `npm run crosswalk` in `analysis/` first.");
    this.name = "CrosswalkNotFoundError";
  }
}

export async function fetchCrosswalk(): Promise<CrosswalkData> {
  const res = await fetch("/crosswalk.json");
  if (res.status === 404) throw new CrosswalkNotFoundError();
  if (!res.ok) throw new Error(`Failed to load crosswalk.json: ${res.status}`);
  return res.json();
}
