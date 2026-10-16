import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toReadableRespondents, type RespondentsJson } from "../lib/respondentsReadable.ts";
import { writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS } from "../config.ts";

const VIZ_DIR = join(ARTIFACTS, "viz");
const respondentsPath = join(VIZ_DIR, "respondents.json");
const readablePath = join(VIZ_DIR, "respondents.readable.json");
// A dedicated manifest dir, not VIZ_DIR itself — s12-vizdata.ts already
// writes its own manifest.json there and this would silently clobber it.
const manifestDir = join(ARTIFACTS, "s19");

async function main() {
  if (!existsSync(respondentsPath)) {
    throw new Error(`${respondentsPath} not found. Run "npm run vizdata" first (analysis/src/stages/s12-vizdata.ts) to produce it.`);
  }

  const data: RespondentsJson = JSON.parse(readFileSync(respondentsPath, "utf8"));
  const rows = toReadableRespondents(data);

  mkdirSync(VIZ_DIR, { recursive: true });
  writeFileSync(readablePath, JSON.stringify(rows, null, 2));

  writeManifest(manifestDir, {
    script: "s19-respondents-readable",
    inputFiles: [respondentsPath],
    outputFiles: [readablePath],
  });

  console.log(`Wrote ${rows.length} readable respondent rows to ${readablePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
