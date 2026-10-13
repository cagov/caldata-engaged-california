/**
 * Fetches and decodes the export written by `analysis/src/stages/s13-rooms.ts`
 * (the Phase 2 deliberation-rooms workbook). Mirrors that stage's output
 * shape but is intentionally not shared code with `analysis/` — viz/ is a
 * standalone app that only ever reads the JSON contract, exactly like
 * `data.ts` does for `respondents.json`.
 */

export interface ReconciliationEntry {
  scope: string;
  field: string;
  stated: number;
  computed: number;
}

export interface RoomsMeta {
  generated: string;
  sourceFile: string;
  sourceHash: string;
  sessions: number;
  attendees: number;
  ideas: number;
  votes: number;
  sampleCaveat: string;
  /** Every stated-vs-recomputed disagreement found in the workbook. */
  reconciliation: ReconciliationEntry[];
  /** True once s16-figjam-linkage.ts has run and at least one idea carries a real conceptId. */
  hasIdeaLinkage: boolean;
  /** Fraction (0-1) of `ideas` with a non-null `conceptId` — linkage is
   * partial by design (see s16-figjam-linkage.ts's unmatched report), so
   * this is what tells a caller how much of the ring can actually
   * highlight, not just whether any of it can. */
  linkageCoverage: number;
}

export interface RoomsTheme {
  id: string;
  name: string;
  votes: number;
  ideas: number;
  topIdeas: number;
  subthemes: number;
}

export interface RoomsSubtheme {
  id: string;
  themeId: string;
  name: string;
  statedVotes: number | null;
  statedIdeas: number | null;
  statedSessions: number | null;
  votes: number;
  ideas: number;
  topIdeas: number;
  concepts: number;
}

export interface RoomsConcept {
  id: string;
  subthemeId: string;
  themeId: string;
  name: string;
  sessions: number;
  votes: number;
  ideas: number;
  topIdeas: number;
}

export interface RoomsSession {
  id: string;
  number: number;
  date: string;
  attendees: number;
  facilitators: number;
  ideas: number;
  votes: number;
  votesPerAttendee: number;
}

export interface RoomsIdea {
  id: string;
  sessionNumber: number;
  votes: number;
  voteRatio: number;
  /** Populated for ~85% of ideas by s16-figjam-linkage.ts's deterministic
   * board join; null for the rest (unmatched, see meta.linkageCoverage). */
  conceptId: string | null;
}

export interface RoomsData {
  meta: RoomsMeta;
  themes: RoomsTheme[];
  subthemes: RoomsSubtheme[];
  concepts: RoomsConcept[];
  sessions: RoomsSession[];
  ideas: RoomsIdea[];
}

export class RoomsNotFoundError extends Error {
  constructor() {
    super("No export found — run `npm run rooms` in `analysis/` first.");
    this.name = "RoomsNotFoundError";
  }
}

export async function fetchRooms(): Promise<RoomsData> {
  const res = await fetch("/rooms.json");
  if (res.status === 404) throw new RoomsNotFoundError();
  if (!res.ok) throw new Error(`Failed to load rooms.json: ${res.status}`);
  return res.json();
}

// Idea text is participant response text (README data rule 2: never in git,
// never in rooms.json) — fetched lazily only once a room is actually
// opened, and cached so reopening any room after the first click never
// re-fetches. Unlike fetchVerbatims there's only ever one file here (not one
// per question), so the cache is a single memoized promise, not a Map.
let roomIdeasPending: Promise<Record<string, string>> | null = null;

export function fetchRoomIdeas(): Promise<Record<string, string>> {
  if (!roomIdeasPending) {
    roomIdeasPending = fetch("/roomIdeas.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load roomIdeas.json: ${res.status}`);
      return res.json();
    });
  }
  return roomIdeasPending;
}
