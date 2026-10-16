import { readFileSync } from "node:fs";
import { z } from "zod";
import { QUESTIONS, type Column, type QuestionId } from "../config.ts";

const QUESTION_IDS = QUESTIONS.map((q) => q.id) as [QuestionId, ...QuestionId[]];
const COLUMNS = QUESTIONS.map((q) => q.column) as [Column, ...Column[]];

const ThemeSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().min(1),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
  examples: z.array(z.string()),
  // Optional: present on themes carried over from files-svelte/codebooks.json
  // (verification/provenance audit metadata from the discovery passes).
  // Absent on hand-authored themes with no such audit trail — never
  // required, never defaulted, so its absence is never confused with a
  // "supported" verdict.
  verification: z.enum(["supported", "needs_verification"]).optional(),
  provenance: z.string().optional(),
});

export type Theme = z.infer<typeof ThemeSchema>;

const QuestionSchema = z.object({
  id: z.enum(QUESTION_IDS),
  column: z.enum(COLUMNS),
  prompt: z.string().min(1),
  themes: z.array(ThemeSchema).min(1),
});

const CodebookSchema = z
  .object({
    version: z.string().min(1),
    questions: z.array(QuestionSchema).min(1),
  })
  .superRefine((cb, ctx) => {
    const seen = new Map<string, number>();
    cb.questions.forEach((q, qi) => {
      q.themes.forEach((t, ti) => {
        const count = seen.get(t.code) ?? 0;
        seen.set(t.code, count + 1);
        if (count > 0) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate theme code "${t.code}" found across questions (must be globally unique)`,
            path: ["questions", qi, "themes", ti, "code"],
          });
        }
      });
    });
  });

export type Codebook = z.infer<typeof CodebookSchema>;

export function loadCodebook(path: string): Codebook {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return CodebookSchema.parse(parsed);
}
