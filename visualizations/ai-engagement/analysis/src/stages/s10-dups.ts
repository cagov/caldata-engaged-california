import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { findDupClusters, type DupCluster } from "../lib/dups.ts";
import { writeManifest } from "../lib/manifest.ts";
import { CLEAN_CSV, ID_COLUMN, ARTIFACTS, QUESTIONS } from "../config.ts";

const statusFinalPath = join(ARTIFACTS, "s04", "status-final.jsonl");
const outputDir = join(ARTIFACTS, "s10");

interface StatusRecord {
  id: string;
  question: string;
  status: string;
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function main() {
  const rows = await loadCsv(CLEAN_CSV);
  const statusRecords = readJsonl<StatusRecord>(statusFinalPath);

  const substantiveIds = new Set(statusRecords.filter((r) => r.status === "substantive").map((r) => `${r.id} ${r.question}`));

  mkdirSync(outputDir, { recursive: true });

  const clustersByQuestion: Record<string, DupCluster[]> = {};
  const outputFiles: string[] = [];

  for (const q of QUESTIONS) {
    const items = rows
      .filter((row) => substantiveIds.has(`${row[ID_COLUMN]} ${q.id}`))
      .map((row) => ({ id: row[ID_COLUMN], text: (row[q.column] ?? "").trim() }));

    const clusters = findDupClusters(items);
    clustersByQuestion[q.id] = clusters;

    const clusteredRespondents = clusters.reduce((sum, c) => sum + c.ids.length, 0);
    console.log(`${q.id}: ${items.length} substantive answers, ${clusters.length} cluster(s), ${clusteredRespondents} respondent(s) in a cluster`);
  }

  const outputPath = join(outputDir, "dup-clusters.json");
  writeFileSync(outputPath, JSON.stringify(clustersByQuestion, null, 2));
  outputFiles.push(outputPath);

  writeManifest(outputDir, {
    script: "s10-dups",
    inputFiles: [CLEAN_CSV, statusFinalPath],
    outputFiles,
  });

  console.log(`\nWrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
