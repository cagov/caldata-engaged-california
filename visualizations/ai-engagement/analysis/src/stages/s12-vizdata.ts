import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { loadCodebook } from "../lib/codebook.ts";
import { buildSegments, encodeRespondents, buildThemeIndex, type ThemeIndex } from "../lib/vizdata.ts";
import { attendeeIds, withPhaseColumn, unmatchedAttendees, PHASE_COLUMN, PHASE_2 } from "../lib/phase.ts";
import { sha256, writeManifest } from "../lib/manifest.ts";
import { CLEAN_CSV, ID_COLUMN, ARTIFACTS, QUESTIONS, SEGMENTS, VIZ_SEGMENTS, SAMPLE_CAVEAT, CODEBOOK_PATH, ATTENDEE_CSV } from "../config.ts";

const VIZ_DIR = join(ARTIFACTS, "viz");
const labelsPath = join(ARTIFACTS, "s08", "labels.jsonl");
const statusFinalPath = join(ARTIFACTS, "s04", "status-final.jsonl");
// s04's deterministic-plus-LLM-judged output, keyed on the same ids as the
// current DATA_CSV. s04 is id-keyed (unlike judgments.json, which is keyed on
// question+text), so it goes stale the moment the source CSV's ids change —
// falling back to s03's purely-deterministic pass keeps the export honest
// (blank/refused/substantive/needs_judgment) instead of defaulting everything
// to "blank" until s04 is re-run against the new ids.
const statusS03Path = join(ARTIFACTS, "s03", "status.jsonl");

interface StatusRecord {
  id: string;
  question: string;
  status: string;
}

interface LabelRecord {
  id: string;
  field: string;
  code: string;
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * `labels.jsonl` is written by s08-classify and may not exist yet (Step 3
 * pending) — mirrors loadStatusById's degrade-gracefully-with-a-warning
 * pattern rather than failing the whole export over missing theme data.
 */
function loadLabels(): LabelRecord[] | null {
  try {
    return readJsonl<LabelRecord>(labelsPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`⚠ ${labelsPath} not found — exporting with no theme data (classification not yet run).`);
      return null;
    }
    throw err;
  }
}

function readStatusJsonl(path: string): Record<string, Record<string, string>> {
  const raw = readFileSync(path, "utf-8");
  const statusById: Record<string, Record<string, string>> = {};
  for (const line of raw.trim().split("\n")) {
    if (!line) continue;
    const rec: StatusRecord = JSON.parse(line);
    statusById[rec.id] ??= {};
    statusById[rec.id][rec.question] = rec.status;
  }
  return statusById;
}

/**
 * `attendee demographics` links Phase 2 (deliberation) membership onto the
 * survey export via SURVEY_RESPONDENT_ID — see docs/SOURCE.md. Mirrors
 * loadLabels' degrade-gracefully pattern: missing file means "no Phase
 * breakdown this run," not a failed export.
 */
async function loadAttendeeIds(): Promise<{ ids: Set<string> | null; sourcePath: string | null }> {
  try {
    const rows = await loadCsv(ATTENDEE_CSV);
    return { ids: attendeeIds(rows, ID_COLUMN), sourcePath: ATTENDEE_CSV };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`⚠ ${ATTENDEE_CSV} not found — exporting with no Phase breakdown.`);
      return { ids: null, sourcePath: null };
    }
    throw err;
  }
}

function loadStatusById(): { statusById: Record<string, Record<string, string>>; sourcePath: string | null } {
  try {
    return { statusById: readStatusJsonl(statusFinalPath), sourcePath: statusFinalPath };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  try {
    console.warn(`⚠ ${statusFinalPath} not found — falling back to ${statusS03Path} (needs_judgment cells not yet LLM-judged).`);
    return { statusById: readStatusJsonl(statusS03Path), sourcePath: statusS03Path };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`⚠ Neither ${statusFinalPath} nor ${statusS03Path} exist yet — statuses default to "blank".`);
      return { statusById: {}, sourcePath: null };
    }
    throw err;
  }
}

async function main() {
  const rows = await loadCsv(CLEAN_CSV);
  const { statusById, sourcePath: statusSourcePath } = loadStatusById();
  const { ids: attendeeIdSet, sourcePath: attendeeSourcePath } = await loadAttendeeIds();
  const phasedRows = attendeeIdSet ? withPhaseColumn(rows, attendeeIdSet, ID_COLUMN) : rows;

  const labels = loadLabels();
  let themeIndex: ThemeIndex | undefined;
  if (labels) {
    const codebook = loadCodebook(CODEBOOK_PATH);
    const ids = rows.map((row) => row[ID_COLUMN]);
    themeIndex = buildThemeIndex(codebook, labels, QUESTIONS, ids, statusById);
  }

  const segments = buildSegments(phasedRows, attendeeIdSet ? VIZ_SEGMENTS : SEGMENTS);
  const encoded = encodeRespondents(phasedRows, segments, QUESTIONS, statusById, ID_COLUMN, themeIndex);

  mkdirSync(VIZ_DIR, { recursive: true });

  const respondentsPath = join(VIZ_DIR, "respondents.json");
  writeFileSync(
    respondentsPath,
    JSON.stringify(
      {
        meta: {
          generated: new Date().toISOString(),
          sourceHash: sha256(CLEAN_CSV),
          sampleCaveat: SAMPLE_CAVEAT,
          ...encoded.meta,
        },
        respondents: encoded.respondents,
      },
      null,
    ),
  );

  const outputFiles = [respondentsPath];

  for (const q of QUESTIONS) {
    const verbatims: Record<string, string> = {};
    for (const row of rows) {
      const text = row[q.column]?.trim();
      if (text) verbatims[row[ID_COLUMN]] = text;
    }
    const verbatimPath = join(VIZ_DIR, `verbatims.${q.id}.json`);
    writeFileSync(verbatimPath, JSON.stringify(verbatims));
    outputFiles.push(verbatimPath);
  }

  const inputFiles = [CLEAN_CSV];
  if (statusSourcePath) inputFiles.push(statusSourcePath);
  if (labels) inputFiles.push(labelsPath, CODEBOOK_PATH);
  if (attendeeSourcePath) inputFiles.push(attendeeSourcePath);

  writeManifest(VIZ_DIR, {
    script: "s12-vizdata",
    inputFiles,
    outputFiles,
  });

  console.log(`Wrote ${encoded.respondents.length} respondents to ${respondentsPath}`);
  console.log(`Segments: ${segments.map((s) => s.key).join(", ")}`);
  for (const q of QUESTIONS) {
    console.log(`  ${q.id}: statusCounts ${JSON.stringify(encoded.meta.statusCounts[q.id])}`);
  }
  console.log(`Themes: ${encoded.meta.themes.length} (${labels ? "from " + labelsPath : "none — classification not yet run"})`);
  if (attendeeIdSet) {
    const phase2Count = phasedRows.filter((row) => row[PHASE_COLUMN] === PHASE_2).length;
    const unmatched = unmatchedAttendees(rows, attendeeIdSet, ID_COLUMN);
    console.log(`Phase: ${phase2Count} phase-2 of ${phasedRows.length} (${unmatched.length} attendee ids not in the export)`);
  }
}

main();
