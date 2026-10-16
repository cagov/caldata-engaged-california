import { z } from "zod";
import type { Codebook } from "./codebook.ts";
import type { Column } from "../config.ts";

/**
 * The stable, cacheable system prompt: the full multi-question codebook
 * (every code, grouped under its home question) plus the classification
 * rules. Built once per run and sent with cache_control so its ~4k tokens
 * are cached across the whole batch rather than re-billed per respondent.
 */
export function buildClassifySystem(cb: Codebook): string {
  const questionBlocks = cb.questions
    .map((q) => {
      const themeLines = q.themes
        .map(
          (t) =>
            `- ${t.code} (${t.label}): ${t.definition}\n  Includes: ${t.includes.join("; ")}\n  Excludes: ${t.excludes.join("; ")}`,
        )
        .join("\n");
      return `### ${q.id} — "${q.prompt}"\n${themeLines}`;
    })
    .join("\n\n");

  return `You are classifying free-text answers from a California public consultation on AI against a fixed codebook of themes.

${questionBlocks}

Rules:
- This is multi-label classification: a single answer can raise zero, one, or several themes at once. Assign every code that genuinely applies — do not pick just one.
- Assign a code wherever its theme appears, even if the respondent put it under a different question than that theme's "home" question above — cross-field bleed is real (people put government asks in the economy box, describe personal impact while answering the economy question, and so on).
- Only use codes from the lists above. Never invent a new code.
- An empty labels list is a valid, correct answer when no theme genuinely applies to any of the respondent's answers.
- Respond only with the JSON object described by the schema — no prose.`;
}

/** Renders one respondent's substantive answers for the user turn. */
export function buildClassifyUser(answers: { column: Column; prompt: string; text: string }[]): string {
  return answers.map((a) => `[${a.column}] "${a.prompt}"\n${a.text}`).join("\n\n");
}

export const LABELS_SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          code: { type: "string" },
        },
        required: ["field", "code"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels"],
  additionalProperties: false,
} as const;

const labelsPayloadSchema = z.object({
  labels: z.array(z.object({ field: z.string(), code: z.string() })),
});

export interface Label {
  field: Column;
  code: string;
}

/**
 * Parses+validates a classify response. Throws on structural mismatch
 * (wrong shape entirely — a retry-worthy failure at the call site); an
 * individual unknown code is not structural failure, just filtered out
 * into `unknownCodes` for visibility.
 */
export function validateLabels(parsed: unknown, cb: Codebook): { ok: Label[]; unknownCodes: string[] } {
  const { labels } = labelsPayloadSchema.parse(parsed);
  const validCodes = new Set(cb.questions.flatMap((q) => q.themes.map((t) => t.code)));

  const ok: Label[] = [];
  const unknownCodes: string[] = [];
  for (const label of labels) {
    if (validCodes.has(label.code)) {
      ok.push(label as Label);
    } else {
      unknownCodes.push(label.code);
    }
  }
  return { ok, unknownCodes };
}
