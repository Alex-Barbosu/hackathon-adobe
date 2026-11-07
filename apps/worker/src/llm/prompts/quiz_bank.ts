import { DynamicQuestionsOutput, TEMPERATURES, type FindingLite } from "@nologo/core";
import type { z } from "zod";
import type { JsonRequest } from "../client.ts";
import { system, text } from "./shared.ts";

export const PROMPT_VERSION = "quiz_bank@1";
export { DynamicQuestionsOutput };
export type DynamicQuestionsValue = z.infer<typeof DynamicQuestionsOutput>;

const SYSTEM = system(`You write short multiple-choice questions for a brand manager, to decide how an ad should be improved.
You receive diagnosis findings with numbers. Write at most 4 questions. Each question must:
- be about one finding, and cite its finding_key;
- be answerable in under 10 seconds;
- use one of the allowed types: single_choice, multi_choice, yes_no, slider;
- fill exactly one of the allowed slots listed below;
- quote the key number from the finding in plain words (e.g. "44% of viewers").
Never ask about things already covered by the core questions listed below.
Never suggest the brand copy a competitor.
Use type single_choice with options keep/replace/remove for traitor_policy slots, slider (1-5) for
asset_emphasis and generic_escape_priority, and yes_no for known_brand_ack.`);

export interface FindingForPrompt extends FindingLite {
  competitorName: string | null;
}

export function build(
  findings: FindingForPrompt[],
  coreKeys: string[],
  slots: string[],
): Omit<JsonRequest<DynamicQuestionsValue>, "analysisId"> {
  return {
    task: "quiz_bank",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts: [
      text(`Findings (JSON):\n${JSON.stringify(findings)}`),
      text(`Core question keys already planned: ${coreKeys.join(", ")}`),
      text(`Allowed dynamic slots: ${slots.join(", ")}`),
    ],
    schema: DynamicQuestionsOutput,
    temperature: TEMPERATURES.quiz_bank,
  };
}
