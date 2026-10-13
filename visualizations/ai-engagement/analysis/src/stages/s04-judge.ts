import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageBatch, MessageBatchIndividualResponse } from "@anthropic-ai/sdk/resources/messages/batches";
import { loadCsv } from "../lib/load.ts";
import { buildJudgePrompt, parseJudgeResult, JUDGE_OUTPUT_SCHEMA } from "../lib/judge.ts";
import { writeManifest } from "../lib/manifest.ts";
import { PIPELINE_MODEL, QUESTIONS, CLEAN_CSV, ID_COLUMN, ARTIFACTS, type QuestionId } from "../config.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — add it to analysis/.env (see .env.example)");
  process.exit(1);
}

const POLL_INTERVAL_MS = 30_000;

const s03Dir = join(ARTIFACTS, "s03");
const pendingJsonlPath = join(s03Dir, "pending.jsonl");
const statusJsonlPath = join(s03Dir, "status.jsonl");

const outputDir = join(ARTIFACTS, "s04");
const rawDir = join(outputDir, "raw");
const rawResultsPath = join(rawDir, "results.jsonl");
const judgmentsPath = join(outputDir, "judgments.json");
const statusFinalPath = join(outputDir, "status-final.jsonl");
const triagePath = join(outputDir, "triage.jsonl");

interface PendingRecord {
  question: QuestionId;
  text: string;
}

interface StatusRecord {
  id: string;
  question: QuestionId;
  status: "blank" | "refused" | "substantive" | "needs_judgment" | "nonanswer";
  len: number;
  reason?: string;
}

type Judgment = { substantive: boolean; reason: string; model: string };

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

// judgments.json is keyed as `${question} ${text}` (e.g. "government nothing"),
// which doubles as the lookup key from a resolved judgment back onto every
// status.jsonl row that shares that exact (question, text) answer.
function pairKey(question: string, text: string): string {
  return `${question} ${text}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilEnded(client: Anthropic, batchId: string): Promise<MessageBatch> {
  let current = await client.messages.batches.retrieve(batchId);
  while (current.processing_status !== "ended") {
    console.log(`  status=${current.processing_status} counts=${JSON.stringify(current.request_counts)}`);
    await sleep(POLL_INTERVAL_MS);
    current = await client.messages.batches.retrieve(batchId);
  }
  console.log(`  status=ended counts=${JSON.stringify(current.request_counts)}`);
  return current;
}

async function main() {
  mkdirSync(rawDir, { recursive: true });

  const pending = readJsonl<PendingRecord>(pendingJsonlPath);
  const statusRecords = readJsonl<StatusRecord>(statusJsonlPath);
  const questionPromptById = new Map(QUESTIONS.map((q) => [q.id, q.prompt]));

  const pairs = pending.map((p) => {
    const questionPrompt = questionPromptById.get(p.question);
    if (!questionPrompt) throw new Error(`Unknown question id in pending.jsonl: ${p.question}`);
    return { question: p.question, questionPrompt, text: p.text };
  });

  const triage: Record<string, unknown>[] = [];
  const judgments: Record<string, Judgment> = {};

  if (pairs.length === 0) {
    console.log("No pending pairs in artifacts/s03/pending.jsonl — nothing to judge.");
    writeFileSync(rawResultsPath, "");
  } else {
    const client = new Anthropic();

    let batchId: string;
    if (process.env.RESUME_BATCH_ID) {
      console.log(`Resuming batch ${process.env.RESUME_BATCH_ID} (skipping submission)...`);
      batchId = process.env.RESUME_BATCH_ID;
    } else {
      console.log(`Submitting batch of ${pairs.length} judgment request(s)...`);
      const batch = await client.messages.batches.create({
        requests: pairs.map((p, i) => ({
          custom_id: `j-${i}`,
          params: {
            model: PIPELINE_MODEL,
            max_tokens: 4000, // extended thinking may be on by default for PIPELINE_MODEL and counts toward max_tokens
            output_config: { format: { type: "json_schema", schema: JUDGE_OUTPUT_SCHEMA } },
            messages: [{ role: "user", content: buildJudgePrompt(p.questionPrompt, p.text) }],
          },
        })),
      });
      batchId = batch.id;
      console.log(`Batch ${batch.id} submitted; polling every ${POLL_INTERVAL_MS / 1000}s until ended...`);
    }

    await pollUntilEnded(client, batchId);

    const pairByCustomId = new Map(pairs.map((p, i) => [`j-${i}`, p]));

    // Stream results, archiving every raw line to disk before any parsing happens.
    const rawLines: MessageBatchIndividualResponse[] = [];
    const resultStream = await client.messages.batches.results(batchId);
    for await (const line of resultStream) {
      rawLines.push(line);
    }
    writeFileSync(rawResultsPath, rawLines.map((line) => JSON.stringify(line)).join("\n") + (rawLines.length ? "\n" : ""));
    console.log(`Archived ${rawLines.length} raw result line(s) to ${rawResultsPath}`);

    // Only now do we parse the archived results.
    const seenCustomIds = new Set<string>();
    for (const line of rawLines) {
      seenCustomIds.add(line.custom_id);
      const pair = pairByCustomId.get(line.custom_id);
      if (!pair) {
        triage.push({ custom_id: line.custom_id, reason: "result custom_id not found among submitted pairs" });
        continue;
      }

      if (line.result.type !== "succeeded") {
        triage.push({
          custom_id: line.custom_id,
          question: pair.question,
          text: pair.text,
          reason: `batch result type: ${line.result.type}`,
          detail: line.result,
        });
        continue;
      }

      const textBlock = line.result.message.content.find(
        (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
      );
      if (!textBlock) {
        triage.push({
          custom_id: line.custom_id,
          question: pair.question,
          text: pair.text,
          reason: "no text content block in successful result",
        });
        continue;
      }

      try {
        const parsed = parseJudgeResult(textBlock.text);
        judgments[pairKey(pair.question, pair.text)] = { ...parsed, model: PIPELINE_MODEL };
      } catch (err) {
        triage.push({
          custom_id: line.custom_id,
          question: pair.question,
          text: pair.text,
          reason: `parseJudgeResult failed: ${(err as Error).message}`,
          raw: textBlock.text,
        });
      }
    }

    for (const [customId, pair] of pairByCustomId) {
      if (!seenCustomIds.has(customId)) {
        triage.push({ custom_id: customId, question: pair.question, text: pair.text, reason: "no result returned for submitted request" });
      }
    }
  }

  writeFileSync(judgmentsPath, JSON.stringify(judgments, null, 2));
  console.log(`Wrote ${Object.keys(judgments).length} judgment(s) to ${judgmentsPath}`);

  // Join judgments back onto every row that shares each exact (question, text)
  // pair, resolving needs_judgment -> substantive | nonanswer. Never guess:
  // rows whose pair has no resolved judgment stay needs_judgment and are
  // additionally flagged in triage.jsonl.
  const rows = await loadCsv(CLEAN_CSV);
  const textByIdAndQuestion = new Map<string, string>();
  for (const row of rows) {
    const id = row[ID_COLUMN];
    if (!id) continue;
    for (const q of QUESTIONS) {
      textByIdAndQuestion.set(`${id} ${q.id}`, row[q.column] ?? "");
    }
  }

  const finalRecords: StatusRecord[] = statusRecords.map((record) => {
    if (record.status !== "needs_judgment") return record;

    const rawText = textByIdAndQuestion.get(`${record.id} ${record.question}`) ?? "";
    const normalizedText = rawText.trim().toLowerCase();
    const judgment = judgments[pairKey(record.question, normalizedText)];

    if (!judgment) {
      triage.push({
        id: record.id,
        question: record.question,
        text: normalizedText,
        reason: "needs_judgment row has no resolved judgment for its (question, text) pair",
      });
      return record;
    }

    return {
      ...record,
      status: judgment.substantive ? "substantive" : "nonanswer",
      reason: judgment.reason,
    };
  });

  const statusFinalLines = finalRecords.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(statusFinalPath, statusFinalLines + (finalRecords.length ? "\n" : ""));

  const triageLines = triage.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(triagePath, triageLines + (triage.length ? "\n" : ""));

  writeManifest(outputDir, {
    script: "s04-judge",
    inputFiles: [pendingJsonlPath, statusJsonlPath, CLEAN_CSV],
    outputFiles: [judgmentsPath, statusFinalPath, triagePath, rawResultsPath],
    model: PIPELINE_MODEL,
  });

  const remainingNeedsJudgment = finalRecords.filter((r) => r.status === "needs_judgment").length;
  console.log("");
  console.log(`Wrote ${statusFinalPath} (${finalRecords.length} records, ${remainingNeedsJudgment} still needs_judgment)`);
  console.log(`Wrote ${triagePath} (${triage.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
