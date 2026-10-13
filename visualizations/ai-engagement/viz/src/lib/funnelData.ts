/**
 * Fetches and decodes the export written by `analysis/src/stages/s17-funnel.ts`
 * (real phase 1 -> phase 2 participant counts, by region and field of work).
 * Mirrors roomsData.ts/crosswalkData.ts's fetch/NotFoundError shape — viz/
 * shares no code with analysis/, it only ever reads the JSON contract.
 */

export interface FunnelMeta {
  generated: string;
  sourceHashes: { phase1: string; phase2: string; sortition: string };
  sampleCaveat: string;
}

export interface FunnelCategory {
  name: string;
  surveyCount: number;
  attendCount: number;
}

export interface FunnelAttendee {
  region: string;
  fieldOfWork: string;
}

export interface FunnelSession {
  date: string;
  attendees: FunnelAttendee[];
}

export interface FunnelInvited {
  name: string;
  count: number;
}

export interface FunnelData {
  meta: FunnelMeta;
  phase1Total: number;
  regions: FunnelCategory[];
  fieldOfWork: FunnelCategory[];
  sessions: FunnelSession[];
  invitedByRegion: FunnelInvited[];
  invitedTotal: number;
}

export class FunnelNotFoundError extends Error {
  constructor() {
    super("No export found — run `npm run funnel` in `analysis/` first.");
    this.name = "FunnelNotFoundError";
  }
}

export async function fetchFunnel(): Promise<FunnelData> {
  const res = await fetch("/funnel.json");
  if (res.status === 404) throw new FunnelNotFoundError();
  if (!res.ok) throw new Error(`Failed to load funnel.json: ${res.status}`);
  return res.json();
}
