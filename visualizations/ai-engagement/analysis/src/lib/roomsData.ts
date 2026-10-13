/**
 * Pure data-shaping for the Phase 2 "deliberation rooms" view (viz/). No
 * file I/O here — the stage (s13-rooms.ts, a later task) reads the workbook
 * with xlsx.ts's readWorkbook and hashes it; this module only ever sees the
 * resulting `Map<string, string[][]>` (or objects derived from it) and plain
 * strings, so it's unit-testable without touching disk.
 *
 * This workbook (`Policy ideas with votes (sessions 1-14).xlsx`) has real,
 * known internal disagreements between its two data sheets (see the three
 * checks in buildReconciliation below) — unlike the older, validated
 * `deliberation-dataset.xlsx` extraction (worktree `deliberation-rooms`'s
 * `lib/deliberations.ts`), this module reports those disagreements in
 * `meta.reconciliation` instead of throwing. It *does* throw on the one
 * thing the internal analysis notes calls a hard assertion: the `lookup` sheet's
 * attendee count disagreeing with the ideas sheet's own participant count
 * for the same session — that would mean the two sheets no longer agree on
 * who was in the room, which is a different order of problem than a vote
 * tally being off by one.
 */
import { sheetToObjects } from "./xlsx.ts";

// --- Sheet names, exactly as saved (the workbook truncates the first to
// Excel's 31-character sheet-name limit — this is not a typo). ---
export const THEMES_SHEET = "Themes, subthemes, policy conce";
export const IDEAS_SHEET = "policy ideas sheet V4";
export const LOOKUP_SHEET = "lookup";

// Every published number in this project carries a sample caveat (the README's data rules
// rule 5) — but the rooms data comes from 14 sortition-recruited small-group
// sessions, not the self-selected online survey, so it needs its own wording
// rather than reusing config.ts's SAMPLE_CAVEAT (which is specifically about
// self-selection).
export const ROOMS_SAMPLE_CAVEAT =
  "14 small-group sessions (103 participants total), recruited via sortition. " +
  "Too few sessions for statistical inference — read as illustrative of what these particular groups discussed, not as a poll.";

/** One stated-vs-computed disagreement the workbook itself contains. */
export interface ReconciliationEntry {
  scope: string;
  field: string;
  stated: number;
  computed: number;
}

export interface RoomsData {
  meta: {
    generated: string;
    sourceFile: string;
    sourceHash: string;
    sessions: number;
    attendees: number;
    ideas: number;
    votes: number;
    sampleCaveat: string;
    reconciliation: ReconciliationEntry[];
    hasIdeaLinkage: boolean;
    /** Fraction (0-1) of `ideas` with a non-null `conceptId`. Populated by
     * s16-figjam-linkage.ts's deterministic board join, which links most
     * but not all ideas (see that stage's unmatched-stickies report) —
     * this makes the gap visible instead of implying full coverage. 0
     * until that stage has run at least once against this artifact. */
    linkageCoverage: number;
  };
  themes: { id: string; name: string; votes: number; ideas: number; topIdeas: number; subthemes: number }[];
  subthemes: {
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
  }[];
  concepts: {
    id: string;
    subthemeId: string;
    themeId: string;
    name: string;
    sessions: number;
    votes: number;
    ideas: number;
    topIdeas: number;
  }[];
  sessions: {
    id: string;
    number: number;
    date: string;
    attendees: number;
    facilitators: number;
    ideas: number;
    votes: number;
    votesPerAttendee: number;
  }[];
  ideas: { id: string; sessionNumber: number; votes: number; voteRatio: number; conceptId: string | null }[];
}

/** Passed in by the caller (the stage) rather than computed here — this
 * module never touches the filesystem, so it has no way to hash or name the
 * workbook itself. */
export interface RoomsDataOptions {
  sourceFile: string;
  sourceHash: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// --- Small pure parsers, each independently unit-tested -------------------

/**
 * Cols D–G of the themes sheet are text-with-units ("34 votes", "8 policy
 * ideas") rather than numbers — strip everything but the digits. Throws on
 * genuinely unparseable input; unlike the sheet-level reconciliation this
 * guards against, a concept row with no number in its count cell at all is a
 * parsing bug, not a known data disagreement.
 */
export function parseUnitCount(raw: string): number {
  const match = raw.match(/\d+/);
  if (!match) throw new Error(`expected a unit-suffixed count (e.g. "34 votes"), got ${JSON.stringify(raw)}`);
  return Number(match[0]);
}

/** The parenthetical trailing a subtheme label, if present — the "stated"
 * counts a subtheme's own concept rows should (but per the one known
 * exception, don't always) sum to. */
export interface ParsedSubthemeLabel {
  name: string;
  statedSessions: number | null;
  statedVotes: number | null;
  statedIdeas: number | null;
}

const SUBTHEME_LABEL_RE = /^(.+?)\s*\(\s*(\d+)\s*sessions?\s*;\s*(\d+)\s*votes?\s*;\s*(\d+)\s*policy\s*ideas?\s*\)\s*$/i;

/**
 * Subtheme labels carry their own stated counts inline, e.g. "Protecting
 * jobs and employees (10 sessions; 74 votes; 19 policy ideas)". Splits the
 * bare name from the parenthetical. A label with no parenthetical (or one
 * shaped differently than every row in this workbook happens to be) falls
 * back to the raw trimmed string with null stated counts rather than
 * throwing — tolerant, because a missing parenthetical is a labelling
 * choice, not a parse error.
 */
export function parseSubthemeLabel(raw: string): ParsedSubthemeLabel {
  const match = raw.match(SUBTHEME_LABEL_RE);
  if (!match) return { name: raw.trim(), statedSessions: null, statedVotes: null, statedIdeas: null };
  const [, name, sessions, votes, ideas] = match;
  return { name: name.trim(), statedSessions: Number(sessions), statedVotes: Number(votes), statedIdeas: Number(ideas) };
}

/**
 * `Session #` formatting drifts across rows ("1" … "13", then, in an
 * earlier revision, "14.0"). Math.round(Number(...)) rather than string
 * comparison so "14.0", "14", and (hypothetically) "14.00" all normalize the
 * same way.
 */
export function normalizeSessionNumber(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) throw new Error(`invalid Session # ${JSON.stringify(raw)}`);
  return n;
}

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const NUMERIC_RE = /^\d+(\.\d+)?$/;
const LITERAL_DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

function excelSerialToIsoDate(serial: number): string {
  // Truncate any time-of-day fraction — only the calendar day matters here,
  // and it's what "Date only" already gives us for every session anyway.
  const ms = EXCEL_EPOCH_UTC_MS + Math.floor(serial) * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

function literalDateToIso(raw: string): string | null {
  const m = raw.match(LITERAL_DATE_RE);
  if (!m) return null;
  const [, month, day, year] = m;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Dates in the `lookup` sheet are Excel serials (1899-12-30 epoch) for every
 * session except session 1, whose `Date & Time` cell is instead the literal
 * string "Thu, 7/9/2026, 1:00 PM" (its `Date only` cell is a normal serial
 * regardless). Prefers `dateOnly`; falls back to `dateTime` only if
 * `dateOnly` is blank, since `dateOnly` is documented as reliable on every
 * row this workbook actually has. Handles both a numeric-serial and a
 * literal weekday-string form on *either* input, so a future revision that
 * moves the literal-string quirk onto `dateOnly` still parses.
 */
export function parseSessionDate(dateOnly: string, dateTime?: string): string {
  const primary = (dateOnly ?? "").trim();
  if (NUMERIC_RE.test(primary)) return excelSerialToIsoDate(Number(primary));
  const primaryLiteral = literalDateToIso(primary);
  if (primaryLiteral) return primaryLiteral;

  const fallback = (dateTime ?? "").trim();
  if (NUMERIC_RE.test(fallback)) return excelSerialToIsoDate(Number(fallback));
  const fallbackLiteral = literalDateToIso(fallback);
  if (fallbackLiteral) return fallbackLiteral;

  throw new Error(`could not parse a session date from dateOnly=${JSON.stringify(dateOnly)}, dateTime=${JSON.stringify(dateTime)}`);
}

// --- Ideas sheet (sheet 2) --------------------------------------------------

interface ParsedIdeaRow {
  id: string;
  sessionNumber: number;
  ideaText: string;
  votes: number;
  participantCount: number;
}

/**
 * Filters and shapes the ideas sheet's rows. An earlier revision of this
 * workbook carried a provenance note in row 2 col B; the current save
 * doesn't, but this filters on content (a non-empty `Session #` *and*
 * non-empty idea text) rather than a hardcoded row offset, so it's correct
 * whether or not a note row is present, and regardless of which column it
 * left blank.
 *
 * Not exported: both `buildRoomsData` and `buildRoomIdeaText` call this so
 * the idea ids in `RoomsData.ideas` line up exactly with the keys in the
 * separately-exported idea-text map, without duplicating the filter/id
 * logic in two places that could drift apart.
 */
function parseIdeaRows(ideaRecords: Record<string, string>[]): ParsedIdeaRow[] {
  const filtered = ideaRecords.filter(
    (r) => (r["Session #"] ?? "").trim() !== "" && (r["Government Action / Idea"] ?? "").trim() !== "",
  );
  return filtered.map((r, i) => ({
    id: `I-${pad(i + 1, 3)}`,
    sessionNumber: normalizeSessionNumber(r["Session #"]),
    ideaText: r["Government Action / Idea"],
    votes: Number(r["Votes"]) || 0,
    participantCount: Number(r["Session participant count"]) || 0,
  }));
}

// --- Themes / subthemes / concepts sheet (sheet 1) --------------------------

interface ThemeAgg {
  id: string;
  name: string;
  votes: number;
  ideas: number;
  topIdeas: number;
  subthemeIds: Set<string>;
}

interface SubthemeAgg {
  id: string;
  themeId: string;
  parsed: ParsedSubthemeLabel;
  votes: number;
  ideas: number;
  topIdeas: number;
  concepts: number;
}

/**
 * Builds themes/subthemes/concepts from sheet 1's forward-filled rows, plus
 * the reconciliation entries that fall out of comparing each subtheme's
 * stated (parenthetical) counts against what its own concept rows sum to.
 *
 * Every stated-vs-computed disagreement gets its own entry — the plan's
 * data model documents `reconciliation` as holding "every stated-vs-
 * recomputed disagreement," not one summary row per subtheme. This
 * workbook's one disagreeing subtheme ("Empowering people to protect their
 * data") disagrees on *both* votes and ideas, so it contributes two entries
 * (field: "votes" and field: "ideas"), not one.
 */
function buildHierarchy(themeRecords: Record<string, string>[]): {
  themes: RoomsData["themes"];
  subthemes: RoomsData["subthemes"];
  concepts: RoomsData["concepts"];
  subthemeReconciliation: ReconciliationEntry[];
} {
  const rows = themeRecords.filter(
    (r) => (r["Theme"] ?? "").trim() !== "" && (r["Subtheme"] ?? "").trim() !== "" && (r["Policy concept"] ?? "").trim() !== "",
  );

  const themeIdByName = new Map<string, string>();
  const themeAggs = new Map<string, ThemeAgg>();
  const subthemeIdByLabel = new Map<string, string>();
  const subthemeAggs = new Map<string, SubthemeAgg>();
  const concepts: RoomsData["concepts"] = [];

  rows.forEach((r, i) => {
    const themeName = r["Theme"].trim();
    if (!themeIdByName.has(themeName)) {
      const id = `T${themeIdByName.size + 1}`;
      themeIdByName.set(themeName, id);
      themeAggs.set(id, { id, name: themeName, votes: 0, ideas: 0, topIdeas: 0, subthemeIds: new Set() });
    }
    const themeId = themeIdByName.get(themeName)!;

    const subthemeLabel = r["Subtheme"].trim();
    if (!subthemeIdByLabel.has(subthemeLabel)) {
      const id = `ST-${pad(subthemeIdByLabel.size + 1, 2)}`;
      subthemeIdByLabel.set(subthemeLabel, id);
      subthemeAggs.set(id, { id, themeId, parsed: parseSubthemeLabel(subthemeLabel), votes: 0, ideas: 0, topIdeas: 0, concepts: 0 });
    }
    const subthemeId = subthemeIdByLabel.get(subthemeLabel)!;
    themeAggs.get(themeId)!.subthemeIds.add(subthemeId);

    const sessions = parseUnitCount(r["Sessions"]);
    const votes = parseUnitCount(r["Votes"]);
    const ideas = parseUnitCount(r["Ideas"]);
    const topIdeas = parseUnitCount(r["Top ideas"]);

    concepts.push({
      id: `C-${pad(i + 1, 2)}`,
      subthemeId,
      themeId,
      name: r["Policy concept"].trim(),
      sessions,
      votes,
      ideas,
      topIdeas,
    });

    const subthemeAgg = subthemeAggs.get(subthemeId)!;
    subthemeAgg.votes += votes;
    subthemeAgg.ideas += ideas;
    subthemeAgg.topIdeas += topIdeas;
    subthemeAgg.concepts += 1;

    const themeAgg = themeAggs.get(themeId)!;
    themeAgg.votes += votes;
    themeAgg.ideas += ideas;
    themeAgg.topIdeas += topIdeas;
  });

  const themes: RoomsData["themes"] = [...themeAggs.values()].map((t) => ({
    id: t.id,
    name: t.name,
    votes: t.votes,
    ideas: t.ideas,
    topIdeas: t.topIdeas,
    subthemes: t.subthemeIds.size,
  }));

  const subthemeReconciliation: ReconciliationEntry[] = [];
  const subthemes: RoomsData["subthemes"] = [...subthemeAggs.values()].map((s) => {
    const { parsed } = s;
    if (parsed.statedVotes !== null && parsed.statedVotes !== s.votes) {
      subthemeReconciliation.push({ scope: parsed.name, field: "votes", stated: parsed.statedVotes, computed: s.votes });
    }
    if (parsed.statedIdeas !== null && parsed.statedIdeas !== s.ideas) {
      subthemeReconciliation.push({ scope: parsed.name, field: "ideas", stated: parsed.statedIdeas, computed: s.ideas });
    }
    return {
      id: s.id,
      themeId: s.themeId,
      name: parsed.name,
      statedVotes: parsed.statedVotes,
      statedIdeas: parsed.statedIdeas,
      statedSessions: parsed.statedSessions,
      votes: s.votes,
      ideas: s.ideas,
      topIdeas: s.topIdeas,
      concepts: s.concepts,
    };
  });

  return { themes, subthemes, concepts, subthemeReconciliation };
}

// --- Lookup sheet + sessions -------------------------------------------------

/**
 * Builds the 14 rooms from `lookup` (attendee counts, dates) joined with the
 * per-session rollups of the already-parsed idea rows.
 *
 * Session 15 has a `Date only` but a blank `Attendee count` and no ideas of
 * its own — excluded by filtering on a non-blank `Attendee count` rather
 * than hardcoding "exclude session 15", so a future revision that adds a
 * 16th non-room row still works.
 *
 * Throws (does not add a reconciliation entry) if a session's lookup
 * attendee count disagrees with its own idea rows' participant count, or if
 * a single session's idea rows disagree with *each other* on participant
 * count — the internal analysis notes verified these agree on all 14 sessions and
 * says to "fail loudly" if a future revision diverges, unlike the three
 * softer, already-known sheet-vs-sheet disagreements this module reports
 * instead of throwing on.
 */
function buildSessions(lookupRecords: Record<string, string>[], parsedIdeas: ParsedIdeaRow[]): RoomsData["sessions"] {
  const lookupRows = lookupRecords
    .filter((r) => (r["Session #"] ?? "").trim() !== "")
    .map((r) => ({
      number: normalizeSessionNumber(r["Session #"]),
      attendeeCount: (r["Attendee count"] ?? "").trim(),
      dateOnly: r["Date only"] ?? "",
      dateTime: r["Date & Time"] ?? "",
    }))
    .filter((r) => r.attendeeCount !== "");

  const ideasBySession = new Map<number, { ideas: number; votes: number; participantCounts: Set<number> }>();
  for (const idea of parsedIdeas) {
    const agg = ideasBySession.get(idea.sessionNumber) ?? { ideas: 0, votes: 0, participantCounts: new Set<number>() };
    agg.ideas += 1;
    agg.votes += idea.votes;
    agg.participantCounts.add(idea.participantCount);
    ideasBySession.set(idea.sessionNumber, agg);
  }

  return lookupRows
    .sort((a, b) => a.number - b.number)
    .map((row) => {
      const attendees = Number(row.attendeeCount);
      const agg = ideasBySession.get(row.number) ?? { ideas: 0, votes: 0, participantCounts: new Set<number>() };

      if (agg.participantCounts.size > 1) {
        throw new Error(
          `session ${row.number}: its own idea rows disagree with each other on Session participant count (${[...agg.participantCounts].join(", ")})`,
        );
      }
      const participantCount = agg.participantCounts.size === 1 ? [...agg.participantCounts][0] : attendees;
      if (participantCount !== attendees) {
        throw new Error(
          `session ${row.number}: lookup sheet's Attendee count (${attendees}) disagrees with the ideas sheet's Session ` +
            `participant count (${participantCount}) — the internal analysis notes' "these agree on all 14 sessions" assumption no ` +
            "longer holds; this needs a human look, not a silent reconciliation entry.",
        );
      }

      return {
        id: `S${pad(row.number, 2)}`,
        number: row.number,
        date: parseSessionDate(row.dateOnly, row.dateTime),
        attendees,
        facilitators: 1, // stated assumption — see the internal analysis notes and docs/SOURCE.md
        ideas: agg.ideas,
        votes: agg.votes,
        votesPerAttendee: attendees > 0 ? agg.votes / attendees : 0,
      };
    });
}

// --- Public entry points -----------------------------------------------------

/**
 * Builds everything `RoomsData` needs except idea text, from the raw
 * `Map<string, string[][]>` `readWorkbook` produces. Idea text is
 * participant response text (README data rule 2: never commit response text
 * to git) — it's deliberately never part of this return value; call
 * `buildRoomIdeaText` for that, separately, so a caller that only wants the
 * committed-safe `rooms.json` never has to touch it.
 */
export function buildRoomsData(sheets: Map<string, string[][]>, opts: RoomsDataOptions): RoomsData {
  const themeRecords = sheetToObjects(sheets.get(THEMES_SHEET) ?? []);
  const ideaRecords = sheetToObjects(sheets.get(IDEAS_SHEET) ?? []);
  const lookupRecords = sheetToObjects(sheets.get(LOOKUP_SHEET) ?? []);

  const parsedIdeas = parseIdeaRows(ideaRecords);
  const { themes, subthemes, concepts, subthemeReconciliation } = buildHierarchy(themeRecords);
  const sessions = buildSessions(lookupRecords, parsedIdeas);

  // The two known workbook-level disagreements: sheet 1's concept rows sum
  // to fewer ideas/votes than sheet 2 actually has. Computed rather than
  // hardcoded, so this naturally reports nothing once/if a future revision
  // reconciles the two sheets.
  const conceptIdeasTotal = concepts.reduce((sum, c) => sum + c.ideas, 0);
  const conceptVotesTotal = concepts.reduce((sum, c) => sum + c.votes, 0);
  const sheetIdeasTotal = parsedIdeas.length;
  const sheetVotesTotal = parsedIdeas.reduce((sum, idea) => sum + idea.votes, 0);

  const reconciliation: ReconciliationEntry[] = [];
  if (conceptIdeasTotal !== sheetIdeasTotal) {
    reconciliation.push({ scope: "workbook", field: "ideas", stated: conceptIdeasTotal, computed: sheetIdeasTotal });
  }
  if (conceptVotesTotal !== sheetVotesTotal) {
    reconciliation.push({ scope: "workbook", field: "votes", stated: conceptVotesTotal, computed: sheetVotesTotal });
  }
  reconciliation.push(...subthemeReconciliation);

  return {
    meta: {
      generated: new Date().toISOString(),
      sourceFile: opts.sourceFile,
      sourceHash: opts.sourceHash,
      sessions: sessions.length,
      attendees: sessions.reduce((sum, s) => sum + s.attendees, 0),
      ideas: sheetIdeasTotal,
      votes: sheetVotesTotal,
      sampleCaveat: ROOMS_SAMPLE_CAVEAT,
      reconciliation,
      hasIdeaLinkage: false, // flips true once s16-figjam-linkage.ts runs and ideas carry conceptId
      linkageCoverage: 0,
    },
    themes,
    subthemes,
    concepts,
    sessions,
    ideas: parsedIdeas.map((idea) => ({
      id: idea.id,
      sessionNumber: idea.sessionNumber,
      votes: idea.votes,
      // Recomputed from votes/participantCount rather than reading the
      // sheet's own "Vote ratio" column (col F) directly — the two agree on
      // every row this workbook actually has, but computing it is one fewer
      // string-to-float parse to trust.
      voteRatio: idea.participantCount > 0 ? idea.votes / idea.participantCount : 0,
      conceptId: null, // filled in by Task 6, gated separately
    })),
  };
}

/**
 * The idea id -> free-text map, kept out of `RoomsData`/`rooms.json` on
 * purpose: idea text is participant response text, which per README data rule
 * 2 must never be committed to git, and `rooms.json` is the artifact a later
 * task publishes without a gitignore boundary around it. This is the
 * "roomIdeas" side output the internal analysis notes describes — meant to be written
 * to its own gitignored `roomIdeas.json` and fetched lazily only when a room
 * is opened, mirroring `fetchVerbatims`'s caching shape in `viz/src/lib/data.ts`.
 *
 * A plain `Record<string, string>` rather than folding into `RoomsData` (or
 * even returning it alongside `RoomsData` from one call) so a caller that
 * only wants the safe-to-commit-adjacent half never has to import, hold, or
 * accidentally serialize the unsafe half. Calling this with the same
 * `sheets` Map `buildRoomsData` was called with guarantees matching ids: both
 * ultimately parse the ideas sheet through the same internal filter/id
 * logic (`parseIdeaRows`), so `RoomsData.ideas[].id` and this map's keys are
 * always in exact correspondence for a given workbook snapshot.
 */
export function buildRoomIdeaText(sheets: Map<string, string[][]>): Record<string, string> {
  const ideaRecords = sheetToObjects(sheets.get(IDEAS_SHEET) ?? []);
  const parsedIdeas = parseIdeaRows(ideaRecords);
  const out: Record<string, string> = {};
  for (const idea of parsedIdeas) out[idea.id] = idea.ideaText;
  return out;
}
