import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { linkIdeasViaFigjam, type FigjamExtract } from "../lib/figjamLinkage.ts";
import type { RoomsData } from "../lib/roomsData.ts";
import { writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS } from "../config.ts";

// Deterministic, LLM-free idea->concept linkage for rooms.json, sourced
// from a frozen snapshot of the team's FigJam sticky-note board (see
// config/figjam-idea-concept-map.json and figjamLinkage.ts's module doc).
// Unlike s14-idea-concept.ts, this is not a classification proposal
// gated behind human review — it's a geometric+textual join against
// already-authoritative board content, so it writes directly to
// rooms.json. Coverage is partial (see linkageCoverage) and reported, not
// hidden.

const FIGJAM_MAP_PATH = "config/figjam-idea-concept-map.json";

const VIZ_DIR = join(ARTIFACTS, "viz");
const roomsPath = join(VIZ_DIR, "rooms.json");
const roomIdeasPath = join(VIZ_DIR, "roomIdeas.json");

const outputDir = join(ARTIFACTS, "s16");
const unmatchedPath = join(outputDir, "unmatched-stickies.json");

function main() {
  const extract: FigjamExtract = JSON.parse(readFileSync(FIGJAM_MAP_PATH, "utf8"));
  const roomsData: RoomsData = JSON.parse(readFileSync(roomsPath, "utf8"));
  const roomIdeaText: Record<string, string> = JSON.parse(readFileSync(roomIdeasPath, "utf8"));

  const { linked, unmatchedStickies } = linkIdeasViaFigjam(extract, roomIdeaText);

  // The board's own text export uses straight apostrophes; rooms.json's
  // concept names (parsed from the xlsx) use curly ones — normalize both
  // sides so "don't" and "don't" compare equal without weakening the match
  // in any other way.
  const straightenApostrophes = (s: string) => s.replace(/[‘’]/g, "'");
  const conceptIdByName = new Map(roomsData.concepts.map((c) => [straightenApostrophes(c.name), c.id]));
  const conceptIdByIdeaId = new Map<string, string>();
  const unresolvedConceptNames = new Set<string>();
  for (const { ideaId, conceptName } of linked) {
    const conceptId = conceptIdByName.get(straightenApostrophes(conceptName));
    if (conceptId) {
      conceptIdByIdeaId.set(ideaId, conceptId);
    } else {
      unresolvedConceptNames.add(conceptName);
    }
  }

  // Reset every idea's conceptId before applying this run's mapping, so the
  // stage is idempotent — re-running it never leaves a stale link from a
  // previous run's (possibly different) linkage on an idea this run
  // couldn't resolve.
  let linkedCount = 0;
  for (const idea of roomsData.ideas) {
    const conceptId = conceptIdByIdeaId.get(idea.id);
    idea.conceptId = conceptId ?? null;
    if (conceptId) linkedCount++;
  }

  roomsData.meta.hasIdeaLinkage = linkedCount > 0;
  roomsData.meta.linkageCoverage = roomsData.ideas.length > 0 ? linkedCount / roomsData.ideas.length : 0;

  writeFileSync(roomsPath, JSON.stringify(roomsData));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    unmatchedPath,
    JSON.stringify(
      {
        unresolvedConceptNames: [...unresolvedConceptNames],
        unmatchedStickies,
      },
      null,
      2,
    ),
  );

  writeManifest(
    outputDir,
    {
      script: "s16-figjam-linkage",
      inputFiles: [FIGJAM_MAP_PATH, roomsPath, roomIdeasPath],
      outputFiles: [roomsPath, unmatchedPath],
    },
    "manifest.figjam-linkage.json",
  );

  console.log(`Linked ${linkedCount} of ${roomsData.ideas.length} ideas to a concept (${(100 * roomsData.meta.linkageCoverage).toFixed(1)}%).`);
  console.log(`Unmatched stickies: ${unmatchedStickies.length} (see ${unmatchedPath}).`);
  if (unresolvedConceptNames.size > 0) {
    console.log(`Concept names from the board with no matching rooms.json concept: ${[...unresolvedConceptNames].join(", ")}`);
  }
}

main();
