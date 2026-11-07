import { z } from "zod";
import { TEMPERATURES } from "@nologo/core";
import type { JsonRequest } from "../client.ts";
import { system, text } from "./shared.ts";

export const PROMPT_VERSION = "report@1";

export const ReportOutput = z.object({ markdown: z.string().max(6000) });
export type ReportValue = z.infer<typeof ReportOutput>;

const SYSTEM = system(`Write a short report for a brand manager in plain English. Use ONLY the numbers in the JSON provided.
Do not compute new numbers. Do not round differently than given. Every number you write must appear
in the JSON. Structure: one-paragraph verdict; what carries the brand; what betrays it; how the
category compares; what the quiz decided; the variants and their measured effect; caveats.
State clearly that the panel is simulated, not real people.
Keep it under 400 words.`);

export function build(
  dataJson: string,
  offendingNumbers: string[] = [],
): Omit<JsonRequest<ReportValue>, "analysisId"> {
  const parts = [text(`Report data (JSON):\n${dataJson}`)];
  if (offendingNumbers.length > 0) {
    parts.push(
      text(`Your previous draft used numbers that are not in the data: ${offendingNumbers.join(", ")}. Rewrite without them.`),
    );
  }
  return {
    task: "report",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts,
    schema: ReportOutput,
    temperature: TEMPERATURES.report,
    cacheKeyExtra: { retry: offendingNumbers.length },
  };
}
