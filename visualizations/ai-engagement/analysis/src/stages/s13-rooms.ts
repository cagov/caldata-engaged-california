import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkbook } from "../lib/xlsx.ts";
import { buildRoomsData, buildRoomIdeaText } from "../lib/roomsData.ts";
import { sha256, writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS, ROOMS_XLSX } from "../config.ts";

const VIZ_DIR = join(ARTIFACTS, "viz");
const MANIFEST_FILENAME = "manifest.rooms.json";

function main() {
  const sourceHash = sha256(ROOMS_XLSX);
  const sheets = readWorkbook(ROOMS_XLSX);

  const roomsData = buildRoomsData(sheets, { sourceFile: ROOMS_XLSX, sourceHash });
  const roomIdeas = buildRoomIdeaText(sheets);

  mkdirSync(VIZ_DIR, { recursive: true });

  const roomsPath = join(VIZ_DIR, "rooms.json");
  writeFileSync(roomsPath, JSON.stringify(roomsData));

  const roomIdeasPath = join(VIZ_DIR, "roomIdeas.json");
  writeFileSync(roomIdeasPath, JSON.stringify(roomIdeas));

  writeManifest(
    VIZ_DIR,
    {
      script: "s13-rooms",
      inputFiles: [ROOMS_XLSX],
      outputFiles: [roomsPath, roomIdeasPath],
    },
    MANIFEST_FILENAME,
  );

  console.log(`Wrote ${roomsData.sessions.length} sessions to ${roomsPath}`);
  console.log(`Wrote ${Object.keys(roomIdeas).length} idea texts to ${roomIdeasPath}`);
  console.log();

  console.log("Session table (session | attendees | ideas | votes):");
  for (const s of roomsData.sessions) {
    console.log(`  S${String(s.number).padStart(2, "0")}  attendees=${s.attendees}  ideas=${s.ideas}  votes=${s.votes}`);
  }
  console.log();

  console.log(`Reconciliation entries (${roomsData.meta.reconciliation.length}):`);
  for (const r of roomsData.meta.reconciliation) {
    console.log(`  [${r.scope}] ${r.field}: stated=${r.stated} computed=${r.computed}`);
  }
}

main();
