import { z } from "zod";

export function buildDiscoverPrompt(questionPrompt: string, existingCodes: string[]): string {
  return `You are reading EVERY substantive response to one question from a California
public consultation on AI. The question was: "${questionPrompt}"

Identify the distinct themes respondents raise. For each theme give: a
SCREAMING_SNAKE code, a short label, a one-sentence definition, 2-4 inclusion
criteria, 1-3 exclusion criteria, 2-3 short VERBATIM example quotes copied
exactly from responses, and a prominence judgment (dominant / common /
occasional / rare). Do NOT report counts or percentages — you are bad at
counting across a context this large, and exact counting happens elsewhere.

Pay particular attention to themes raised by only a handful of respondents:
surfacing concerns held intensely by small groups is a core purpose of this
consultation. A theme raised rarely but distinctly belongs in your list.

An existing draft codebook has these codes: ${existingCodes.join(", ")}. Where a theme you
find matches one, set overlapsExisting to that code; where it is genuinely new,
set it to null.`;
}

export const PROMINENCE_VALUES = ["dominant", "common", "occasional", "rare"] as const;

const CandidateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().min(1),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
  examples: z.array(z.string()),
  prominence: z.enum(PROMINENCE_VALUES),
  overlapsExisting: z.string().nullable(),
});

export type Candidate = z.infer<typeof CandidateSchema>;

const CandidatesResponseSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export type CandidatesResponse = z.infer<typeof CandidatesResponseSchema>;

export const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          label: { type: "string" },
          definition: { type: "string" },
          includes: { type: "array", items: { type: "string" } },
          excludes: { type: "array", items: { type: "string" } },
          examples: { type: "array", items: { type: "string" } },
          prominence: { type: "string", enum: [...PROMINENCE_VALUES] },
          overlapsExisting: { type: ["string", "null"] },
        },
        required: ["code", "label", "definition", "includes", "excludes", "examples", "prominence", "overlapsExisting"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

export function parseCandidates(json: string): CandidatesResponse {
  return CandidatesResponseSchema.parse(JSON.parse(json));
}
