import { z } from "zod";

export function buildJudgePrompt(questionPrompt: string, text: string): string {
  return `A public consultation asked: "${questionPrompt}"

One respondent's complete answer was: "${text}"

Decide whether this answer expresses a position, experience, or genuine answer
to that question, however brief — or whether it is a non-answer (a placeholder,
a refusal, or content-free filler).

Guidance:
- "nothing" / "no" in answer to a question about what someone SHOULD DO is a
  substantive position (they want no action taken).
- "nothing" / "none" in answer to a question about what HAS HAPPENED is a
  substantive report of no impact.
- "n/a", ".", "?", "idk" with no more content are non-answers.
- A bare "yes" or "no" to a question that is not yes/no-able is a non-answer.
- "not sure" answering a prediction question is a substantive expression of
  uncertainty.`;
}

const judgeSchema = z.object({ substantive: z.boolean(), reason: z.string() });
export const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: { substantive: { type: "boolean" }, reason: { type: "string" } },
  required: ["substantive", "reason"],
  additionalProperties: false,
} as const;

export function parseJudgeResult(json: string): { substantive: boolean; reason: string } {
  return judgeSchema.parse(JSON.parse(json));
}
