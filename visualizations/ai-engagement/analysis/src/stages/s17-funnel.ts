import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { buildFunnelData } from "../lib/funnel.ts";
import { sha256, writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS, ATTENDEE_CSV, DEMOGRAPHICS_ROLLUP_CSV, SORTITION_CSV, SAMPLE_CAVEAT } from "../config.ts";

const VIZ_DIR = join(ARTIFACTS, "viz");
const MANIFEST_FILENAME = "manifest.funnel.json";

async function main() {
  const phase1Rows = await loadCsv(DEMOGRAPHICS_ROLLUP_CSV);
  const phase2Rows = await loadCsv(ATTENDEE_CSV);
  const sortitionRows = await loadCsv(SORTITION_CSV);

  const funnel = buildFunnelData(phase1Rows, phase2Rows, sortitionRows);

  mkdirSync(VIZ_DIR, { recursive: true });
  const funnelPath = join(VIZ_DIR, "funnel.json");
  writeFileSync(
    funnelPath,
    JSON.stringify({
      meta: {
        generated: new Date().toISOString(),
        sourceHashes: {
          phase1: sha256(DEMOGRAPHICS_ROLLUP_CSV),
          phase2: sha256(ATTENDEE_CSV),
          sortition: sha256(SORTITION_CSV),
        },
        sampleCaveat: SAMPLE_CAVEAT,
      },
      ...funnel,
    }),
  );

  writeManifest(
    VIZ_DIR,
    {
      script: "s17-funnel",
      inputFiles: [DEMOGRAPHICS_ROLLUP_CSV, ATTENDEE_CSV, SORTITION_CSV],
      outputFiles: [funnelPath],
    },
    MANIFEST_FILENAME,
  );

  console.log(`Wrote ${funnel.phase1Total} phase 1 respondents, ${funnel.sessions.length} sessions to ${funnelPath}`);
  console.log(`Regions: ${funnel.regions.map((r) => `${r.name} (survey=${r.surveyCount}, attend=${r.attendCount})`).join(", ")}`);
  console.log(`Field of work: ${funnel.fieldOfWork.map((f) => `${f.name} (survey=${f.surveyCount}, attend=${f.attendCount})`).join(", ")}`);
  console.log(`Invited: ${funnel.invitedTotal} total — ${funnel.invitedByRegion.map((r) => `${r.name}=${r.count}`).join(", ")}`);
  console.log("Session table (date | attendees):");
  for (const s of funnel.sessions) {
    console.log(`  ${s.date}  attendees=${s.attendees.length}`);
  }
}

main();
