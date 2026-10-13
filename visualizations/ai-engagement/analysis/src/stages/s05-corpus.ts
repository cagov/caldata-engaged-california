import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { interleaveByStratum } from "../lib/corpus.ts";
import { writeManifest } from "../lib/manifest.ts";
import { CLEAN_CSV, QUESTIONS, ID_COLUMN, ARTIFACTS, CORPUS_DIR, SEGMENTS } from "../config.ts";

const statusFinalPath = join(ARTIFACTS, "s04", "status-final.jsonl");
const outputDir = CORPUS_DIR;

interface StatusRecord {
  id: string;
  question: string;
  status: string;
  len: number;
}

interface CorpusItem {
  id: string;
  question: string;
  text: string;
  region: string;
}

async function main() {
  // Load clean CSV responses
  const rows = await loadCsv(CLEAN_CSV);

  // Build a map of responses for fast lookup: id -> row
  const responseMap = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const id = row[ID_COLUMN];
    if (id) {
      responseMap.set(id, row);
    }
  }

  // Load status-final.jsonl
  let statusRecords: StatusRecord[] = [];
  try {
    const statusContent = readFileSync(statusFinalPath, "utf-8");
    statusRecords = statusContent
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`⚠ ${statusFinalPath} does not exist yet (Task 7 pending)`);
      console.warn("Proceeding with empty corpus (expected in this environment).");
      statusRecords = [];
    } else {
      throw err;
    }
  }

  mkdirSync(outputDir, { recursive: true });

  // Collect corpus items by question
  const corpusByQuestion = new Map<string, CorpusItem[]>();

  for (const q of QUESTIONS) {
    corpusByQuestion.set(q.id, []);
  }

  // Process status records: filter substantive, join with response data
  for (const status of statusRecords) {
    if (status.status !== "substantive") {
      continue;
    }

    const response = responseMap.get(status.id);
    if (!response) {
      continue;
    }

    const q = QUESTIONS.find((qq) => qq.id === status.question);
    if (!q) {
      continue;
    }

    const text = response[q.column]?.trim() ?? "";
    if (!text) {
      continue;
    }

    const region = response["REGION"] ?? "";

    const item: CorpusItem = {
      id: status.id,
      question: status.question,
      text,
      region,
    };

    corpusByQuestion.get(status.question)?.push(item);
  }

  // For each question, interleave by REGION and write corpus file
  const inputFiles = [CLEAN_CSV];
  if (statusRecords.length > 0) {
    inputFiles.push(statusFinalPath);
  }
  const outputFiles: string[] = [];

  for (const q of QUESTIONS) {
    const items = corpusByQuestion.get(q.id) ?? [];

    // Interleave by REGION
    const interleaved = interleaveByStratum(items, (item) => item.region);

    // Format and write
    const lines: string[] = [];
    for (const item of interleaved) {
      lines.push(`[${item.id}]`);
      lines.push(item.text);
      lines.push("");
    }

    const corpusPath = join(outputDir, `${q.id}.txt`);
    const content = lines.join("\n");
    writeFileSync(corpusPath, content);
    outputFiles.push(corpusPath);

    // Print stats
    const charCount = content.length;
    const tokenEstimate = Math.ceil(charCount / 4);
    console.log(`${q.id}: ${items.length} substantive answers, ${charCount} chars, ~${tokenEstimate} tokens`);
  }

  // Write manifest (with inputFiles and outputFiles paths)
  writeManifest(ARTIFACTS + "/s05", {
    script: "s05-corpus",
    inputFiles,
    outputFiles,
  });

  console.log("");
  console.log(`Wrote corpus to ${outputDir}/`);
}

main();
