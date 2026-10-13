import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCodebook } from "../lib/codebook.ts";
import {
  loadCrosswalk,
  validateCrosswalk,
  computeUnclaimed,
  computeConceptMetrics,
} from "../lib/crosswalk.ts";
import { writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS, CODEBOOK_PATH, PHASE_CROSSWALK_PATH } from "../config.ts";

const VIZ_DIR = join(ARTIFACTS, "viz");
const RESPONDENTS_PATH = join(VIZ_DIR, "respondents.json");
const ROOMS_PATH = join(VIZ_DIR, "rooms.json");
const OUTPUT_PATH = join(VIZ_DIR, "crosswalk.json");
const MANIFEST_FILENAME = "manifest.crosswalk.json";

const CROSSWALK_CAVEAT =
  "This mapping is interpretive, authored by a human/LLM pass reviewing concept and theme text side by side — " +
  "it is not measured from respondent data. No edge implies any respondent endorsed the concept it points to.";

interface RespondentsMetaThemes {
  meta: {
    themes: { code: string; label: string; home: string }[];
    themeCounts: Record<string, number[]>;
  };
}

interface RoomsForCrosswalk {
  meta: { sourceHash: string };
  subthemes: { id: string; votes: number; ideas: number }[];
  concepts: { id: string; subthemeId: string; sessions: number; ideas: number; topIdeas: number }[];
  sessions: unknown[];
}

function main() {
  const codebook = loadCodebook(CODEBOOK_PATH);
  const crosswalk = loadCrosswalk(PHASE_CROSSWALK_PATH);
  const respondents: RespondentsMetaThemes = JSON.parse(readFileSync(RESPONDENTS_PATH, "utf-8"));
  const rooms: RoomsForCrosswalk = JSON.parse(readFileSync(ROOMS_PATH, "utf-8"));

  const themeCountsByField: Record<string, Record<string, number>> = {};
  for (const [field, counts] of Object.entries(respondents.meta.themeCounts)) {
    themeCountsByField[field] = {};
    respondents.meta.themes.forEach((t, i) => {
      themeCountsByField[field][t.code] = counts[i] ?? 0;
    });
  }

  const errors = validateCrosswalk(crosswalk, {
    conceptIds: rooms.concepts.map((c) => c.id),
    codebookVersion: codebook.version,
    roomsSourceHash: rooms.meta.sourceHash,
    themeCodes: respondents.meta.themes.map((t) => t.code),
    themeCountsByField,
  });
  if (errors.length > 0) {
    console.error(`Crosswalk validation failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const themeNodes = respondents.meta.themes.map((t, i) => ({
    code: t.code,
    label: t.label,
    home: t.home,
    counts: {
      personal: respondents.meta.themeCounts.personal?.[i] ?? 0,
      economy: respondents.meta.themeCounts.economy?.[i] ?? 0,
      government: respondents.meta.themeCounts.government?.[i] ?? 0,
    },
  }));

  const edges = crosswalk.concepts.flatMap((c) =>
    c.sources.map((s) => ({ conceptId: c.conceptId, code: s.code, field: s.field, strength: s.strength, rationale: s.rationale })),
  );

  const unclaimedCodes = computeUnclaimed(crosswalk, respondents.meta.themes).map((t) => t.code);

  const subthemeById = new Map(rooms.subthemes.map((s) => [s.id, s]));
  const totalSessions = rooms.sessions.length;
  const conceptMetrics = rooms.concepts.map((c) => {
    const subtheme = subthemeById.get(c.subthemeId);
    if (!subtheme) throw new Error(`concept ${c.id} references unknown subtheme ${c.subthemeId}`);
    return { conceptId: c.id, ...computeConceptMetrics(c, subtheme, totalSessions) };
  });

  const output = {
    meta: {
      generated: new Date().toISOString(),
      version: crosswalk.version,
      codebookVersion: crosswalk.codebookVersion,
      roomsSourceHash: crosswalk.roomsSourceHash,
      status: crosswalk.status,
      approvedBy: crosswalk.approvedBy,
      method: crosswalk.method,
      caveat: CROSSWALK_CAVEAT,
    },
    themes: themeNodes,
    edges,
    unclaimedCodes,
    concepts: conceptMetrics,
  };

  mkdirSync(VIZ_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output));

  writeManifest(
    VIZ_DIR,
    {
      script: "s15-crosswalk",
      inputFiles: [PHASE_CROSSWALK_PATH, CODEBOOK_PATH, RESPONDENTS_PATH, ROOMS_PATH],
      outputFiles: [OUTPUT_PATH],
    },
    MANIFEST_FILENAME,
  );

  console.log(`Wrote ${edges.length} edges across ${crosswalk.concepts.length} concepts to ${OUTPUT_PATH}`);
  console.log(`${unclaimedCodes.length} of ${themeNodes.length} Phase 1 themes did not carry forward to any concept.`);
  console.log(`Crosswalk status: ${crosswalk.status}${crosswalk.status === "proposed" ? " — viz will show the review banner." : ""}`);
}

main();
