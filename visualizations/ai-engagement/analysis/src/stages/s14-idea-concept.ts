import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { RoomsData } from "../lib/roomsData.ts";
import {
  buildIdeaConceptSystem,
  buildIdeaConceptUser,
  validateIdeaConceptResponse,
  reconcileIdeaConceptMapping,
  IDEA_CONCEPT_SCHEMA,
  type ProposedIdea,
  type ReconciliationRow,
} from "../lib/ideaLinkage.ts";
import { writeManifest } from "../lib/manifest.ts";
import { PIPELINE_MODEL, ARTIFACTS } from "../config.ts";

// Task 6 (⛔ gated, see an internal planning doc): classifies
// each of the 157 deliberation-room policy ideas against one of the 29
// policy concepts in rooms.json, using the same pinned model and archiving
// convention as s08-classify. Per README data rule 1, this stage only ever
// writes a PROPOSAL — it never mutates rooms.json/roomIdeas.json, never sets
// meta.hasIdeaLinkage, and never populates ideas[].conceptId in the
// published artifact. A human reviews artifacts/s14/idea-concept-proposal.json
// and artifacts/s14/reconciliation.json; only after that approval does a
// separate, later task merge the mapping into rooms.json.
//
// This guard must run before any client construction or file read, so that
// running this stage without a key makes zero network calls.
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — add it to analysis/.env (see .env.example)");
  process.exit(1);
}

const VIZ_DIR = join(ARTIFACTS, "viz");
const roomsPath = join(VIZ_DIR, "rooms.json");
const roomIdeasPath = join(VIZ_DIR, "roomIdeas.json");

const outputDir = join(ARTIFACTS, "s14");
const rawDir = join(outputDir, "raw");
const proposalPath = join(outputDir, "idea-concept-proposal.json");
const reconciliationPath = join(outputDir, "reconciliation.json");

interface ProposalEntry {
  ideaId: string;
  conceptId: string | null;
}

function printReconciliationTable(rows: ReconciliationRow[]): void {
  console.log("");
  console.log("Reconciliation (stated vs. computed from the proposed mapping):");
  console.log(
    "  concept                                  | ideas (stated/computed) | votes (stated/computed) | sessions (stated/computed)",
  );
  for (const r of rows) {
    const label = `${r.conceptId} ${r.name}`.slice(0, 40).padEnd(40);
    const ideasMismatch = r.statedIdeas !== r.computedIdeas ? " *" : "";
    const votesMismatch = r.statedVotes !== r.computedVotes ? " *" : "";
    const sessionsMismatch = r.statedSessions !== r.computedSessions ? " *" : "";
    console.log(
      `  ${label} | ${String(r.statedIdeas).padStart(3)}/${String(r.computedIdeas).padStart(3)}${ideasMismatch}` +
        `                 | ${String(r.statedVotes).padStart(3)}/${String(r.computedVotes).padStart(3)}${votesMismatch}` +
        `                 | ${String(r.statedSessions).padStart(2)}/${String(r.computedSessions).padStart(2)}${sessionsMismatch}`,
    );
  }
  console.log("  (* marks a mismatch between the workbook's stated count and this proposal's recomputed count)");
}

async function main() {
  // Reads the already-published, gitignore-adjacent viz artifacts rather
  // than re-deriving them from the xlsx source — s13-rooms is the one place
  // that parses the workbook; this stage only classifies what it already
  // produced.
  const roomsData: RoomsData = JSON.parse(readFileSync(roomsPath, "utf8"));
  const roomIdeas: Record<string, string> = JSON.parse(readFileSync(roomIdeasPath, "utf8"));

  const concepts = roomsData.concepts;
  const validConceptIds = new Set(concepts.map((c) => c.id));
  const systemPrompt = buildIdeaConceptSystem(concepts);

  mkdirSync(rawDir, { recursive: true });

  const client = new Anthropic();

  const proposal: ProposalEntry[] = [];
  const proposedIdeas: ProposedIdea[] = [];
  const rawLines: string[] = [];
  const triage: Record<string, unknown>[] = [];

  for (const idea of roomsData.ideas) {
    const ideaText = roomIdeas[idea.id];
    if (ideaText === undefined) {
      triage.push({ id: idea.id, reason: "no idea text found in roomIdeas.json" });
      continue;
    }

    const message = await client.messages.create({
      model: PIPELINE_MODEL,
      max_tokens: 200,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: IDEA_CONCEPT_SCHEMA } },
      messages: [{ role: "user", content: buildIdeaConceptUser(ideaText) }],
    });

    rawLines.push(JSON.stringify({ ideaId: idea.id, response: message }));

    const textBlock = message.content.find(
      (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
    );
    if (!textBlock) {
      triage.push({ id: idea.id, reason: "no text content block in response" });
      continue;
    }

    try {
      const parsed = JSON.parse(textBlock.text);
      const result = validateIdeaConceptResponse(parsed, validConceptIds);
      if (result.unknownId) {
        triage.push({ id: idea.id, reason: "model returned a concept id not in rooms.json", unknownId: result.unknownId });
      }
      proposal.push({ ideaId: idea.id, conceptId: result.conceptId });
      proposedIdeas.push({ id: idea.id, sessionNumber: idea.sessionNumber, votes: idea.votes, conceptId: result.conceptId });
    } catch (err) {
      triage.push({ id: idea.id, reason: `parse/validate failed: ${(err as Error).message}` });
    }
  }

  writeFileSync(join(rawDir, "results.jsonl"), rawLines.join("\n") + (rawLines.length ? "\n" : ""));

  // The proposal artifact deliberately carries no idea text (judgment call:
  // erring toward NOT including participant text here, per the task brief's
  // guidance to err on that side when unsure — idea-concept-proposal.json
  // is a proposal artifact a reviewer may treat more casually than the
  // tightly-scoped roomIdeas.json, so it stays ideaId/conceptId pairs only).
  writeFileSync(proposalPath, JSON.stringify(proposal, null, 2));

  const reconciliation = reconcileIdeaConceptMapping(concepts, proposedIdeas);
  writeFileSync(reconciliationPath, JSON.stringify(reconciliation, null, 2));

  writeManifest(outputDir, {
    script: "s14-idea-concept",
    inputFiles: [roomsPath, roomIdeasPath],
    outputFiles: [proposalPath, reconciliationPath],
    model: PIPELINE_MODEL,
  });

  console.log(`Classified ${proposal.length} of ${roomsData.ideas.length} idea(s); ${triage.length} triage entr(y/ies).`);
  console.log(`Wrote proposal to ${proposalPath}`);
  console.log(`Wrote reconciliation to ${reconciliationPath}`);
  printReconciliationTable(reconciliation);

  console.log("");
  console.log(
    "⛔ Proposal only. rooms.json/roomIdeas.json are untouched; meta.hasIdeaLinkage stays false. " +
      "A human must review this proposal before any later task merges it in.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
