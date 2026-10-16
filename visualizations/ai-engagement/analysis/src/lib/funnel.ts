/**
 * Pure data-shaping for the participant-funnel-cloud prototype (viz/). No
 * file I/O here — the stage (s17-funnel.ts) does the reading; this module is
 * unit-testable without touching disk. Mirrors phase.ts's split.
 *
 * Two real cohorts, not one hand-authored dataset: phase 1 is every row in
 * the phase 1 demographics export; phase 2 is every row in the attendee
 * demographics export (see phase.ts's own comment — that file only ever
 * contains people who showed up to a session, regardless of ATTENDEE_STATUS,
 * so nothing here filters on that column).
 */
import { FIELD_OF_WORK_SORTITION_CROSSWALK } from "../../config/fieldOfWorkSortitionCrosswalk.ts";
import { NOT_STATED_VALUE, REFUSAL_VALUE } from "./vizdata.ts";

// The 08-28 export's FIELD_OF_WORK_ROLLUP carries this category under two
// spellings (58 rows missing the "s") — almost certainly a typo split of one
// category, not two distinct ones.
const FIELD_OF_WORK_ROLLUP_TYPO_FIX: Record<string, string> = {
  "Good producing and harvesting": "Goods producing and harvesting",
};

// Not a field of work at all — kept as its own substantive category rather
// than folded anywhere, same treatment as vizdata.ts's FIELD_OF_WORK_PASSTHROUGH.
const FIELD_OF_WORK_PASSTHROUGH = new Set(["I don't currently work"]);

const PINNED_VALUES = [NOT_STATED_VALUE, REFUSAL_VALUE];
function isPinned(value: string): boolean {
  return PINNED_VALUES.includes(value);
}

export function normalizeRegion(raw: string): string {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? NOT_STATED_VALUE : trimmed;
}

export function normalizePhase1FieldOfWork(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return NOT_STATED_VALUE;
  if (isPinned(trimmed) || FIELD_OF_WORK_PASSTHROUGH.has(trimmed)) return trimmed;
  return FIELD_OF_WORK_ROLLUP_TYPO_FIX[trimmed] ?? trimmed;
}

export function normalizePhase2FieldOfWork(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return NOT_STATED_VALUE;
  if (isPinned(trimmed) || FIELD_OF_WORK_PASSTHROUGH.has(trimmed)) return trimmed;
  return FIELD_OF_WORK_SORTITION_CROSSWALK[trimmed] ?? trimmed;
}

export interface FunnelCategory {
  name: string;
  surveyCount: number;
  attendCount: number;
}

/**
 * Unions every category name seen in either phase, sorted by descending
 * phase 1 (survey) count — pinned values (refusal / not-stated) always last,
 * same convention as vizdata.ts's segment ordering.
 */
export function buildFunnelCategories(phase1Values: string[], phase2Values: string[]): FunnelCategory[] {
  const surveyCounts = new Map<string, number>();
  for (const v of phase1Values) surveyCounts.set(v, (surveyCounts.get(v) ?? 0) + 1);

  const attendCounts = new Map<string, number>();
  for (const v of phase2Values) attendCounts.set(v, (attendCounts.get(v) ?? 0) + 1);

  const names = new Set([...surveyCounts.keys(), ...attendCounts.keys()]);
  const ordinary = [...names].filter((n) => !isPinned(n));
  const pinned = PINNED_VALUES.filter((n) => names.has(n));

  ordinary.sort((a, b) => (surveyCounts.get(b) ?? 0) - (surveyCounts.get(a) ?? 0));

  return [...ordinary, ...pinned].map((name) => ({
    name,
    surveyCount: surveyCounts.get(name) ?? 0,
    attendCount: attendCounts.get(name) ?? 0,
  }));
}

export interface FunnelAttendee {
  date: string;
  region: string;
  fieldOfWork: string;
}

export interface FunnelSession {
  date: string;
  /** One entry per real attendee — carries both category names jointly (not
   * two independent per-category mix counts) so a client toggling which
   * dimension colors the dots recolors the same fixed set of people rather
   * than implying a region x field-of-work cross-tabulation nobody
   * measured. */
  attendees: { region: string; fieldOfWork: string }[];
}

/**
 * Groups attendees by SESSION_DATE, not SESSION_ID — one row in the export
 * carries a blank SESSION_ID (a data gap, not a 15th session), and every
 * SESSION_ID that IS present maps to exactly one date, so grouping by date
 * both sidesteps the gap and matches the true session count (14).
 *
 * Sessions come back sorted chronologically (ISO date strings sort correctly
 * as plain strings) — this is what places the earliest session at the top of
 * the conversation ring, in date order clockwise.
 */
export function buildFunnelSessions(attendees: FunnelAttendee[]): FunnelSession[] {
  const byDate = new Map<string, FunnelAttendee[]>();
  for (const a of attendees) {
    const list = byDate.get(a.date);
    if (list) list.push(a);
    else byDate.set(a.date, [a]);
  }

  const sessions: FunnelSession[] = [...byDate.entries()].map(([date, rows]) => ({
    date,
    attendees: rows.map((r) => ({ region: r.region, fieldOfWork: r.fieldOfWork })),
  }));

  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return sessions;
}

export interface FunnelInvited {
  name: string;
  count: number;
}

export interface FunnelData {
  phase1Total: number;
  regions: FunnelCategory[];
  fieldOfWork: FunnelCategory[];
  sessions: FunnelSession[];
  invitedByRegion: FunnelInvited[];
  invitedTotal: number;
}

/**
 * Reads the sortition export's Answer -> Invited count columns. Region-only
 * (the export has no field-of-work breakdown), so this never feeds
 * FunnelCategory — a 0 there would misread as "nobody in this field was
 * invited" rather than "not measured".
 */
export function parseSortitionInvited(rows: Record<string, string>[]): Map<string, number> {
  const invited = new Map<string, number>();
  for (const r of rows) {
    const name = (r.Answer ?? "").trim();
    const count = Number((r["Invited count"] ?? "").replace(/,/g, "")) || 0;
    invited.set(name, count);
  }
  return invited;
}

export function buildFunnelData(
  phase1Rows: Record<string, string>[],
  phase2Rows: Record<string, string>[],
  sortitionRows: Record<string, string>[] = [],
): FunnelData {
  // A blank REGION on a phase 1 row is a region-completeness gap, not a
  // refusal — 24 of the 08-28 export's 2702 rows have one (14 of those 24
  // still carry free-text answers), and excluding them is what reproduces
  // the canonical 2678-respondent cohort the rest of the analysis is built
  // on (verified: the remaining rows match the ideas export's region
  // distribution exactly, region for region). All 24 have a populated
  // COUNTY, so a county->region crosswalk could recover them later.
  const statedPhase1Rows = phase1Rows.filter((r) => (r.REGION ?? "").trim() !== "");

  const phase1Regions = statedPhase1Rows.map((r) => normalizeRegion(r.REGION));
  const phase1FieldOfWork = statedPhase1Rows.map((r) => normalizePhase1FieldOfWork(r.FIELD_OF_WORK_ROLLUP));

  const phase2Regions = phase2Rows.map((r) => normalizeRegion(r.REGION));
  const phase2FieldOfWork = phase2Rows.map((r) => normalizePhase2FieldOfWork(r.FIELD_OF_WORK_SORTITION_GROUPING));

  const regions = buildFunnelCategories(phase1Regions, phase2Regions);
  const fieldOfWork = buildFunnelCategories(phase1FieldOfWork, phase2FieldOfWork);

  const attendees: FunnelAttendee[] = phase2Rows.map((r, i) => ({
    date: r.SESSION_DATE,
    region: phase2Regions[i],
    fieldOfWork: phase2FieldOfWork[i],
  }));
  const sessions = buildFunnelSessions(attendees);

  const sortitionInvited = parseSortitionInvited(sortitionRows);
  for (const name of sortitionInvited.keys()) {
    if (!regions.some((r) => r.name === name)) {
      throw new Error(
        `Sortition CSV region "${name}" not found among the demographics export's regions — a rename would silently zero that region's invited quota.`,
      );
    }
  }
  // Every real attendee was necessarily invited, but the sortition export's
  // region rollup has no bucket for the handful of attendees with a blank
  // REGION (it reports 0 invited for them) — floor each region's quota at
  // its own attendCount so nobody appears to attend without being invited.
  const invitedByRegion: FunnelInvited[] = regions.map((r) => ({
    name: r.name,
    count: Math.max(sortitionInvited.get(r.name) ?? 0, r.attendCount),
  }));
  const invitedTotal = invitedByRegion.reduce((sum, r) => sum + r.count, 0);

  return { phase1Total: statedPhase1Rows.length, regions, fieldOfWork, sessions, invitedByRegion, invitedTotal };
}
