import { z } from "zod";
import { TEMPERATURES } from "@nologo/core";
import type { JsonRequest } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "brand_fit@1";

export const BrandFitOutput = z.object({
  versions: z.array(
    z.object({
      version: z.string(),
      tone_match: z.number().int().min(1).max(5),
      taboo_violations: z.array(z.string()).max(5),
      mandatory_copy_ok: z.boolean(),
      note: z.string().max(160),
    }),
  ),
});
export type BrandFitValue = z.infer<typeof BrandFitOutput>;

const SYSTEM = system(`Judge whether each edited version of the advertisement still fits the brand brief.
For each version report: tone match from 1 (contradicts the brief) to 5 (fully matches),
any taboo from the brief that is violated, whether mandatory copy is still present and legible,
and one short note. Judge only against the brief, not your own taste.`);

export function build(
  briefJson: string,
  original: ImageRef,
  variants: Array<ImageRef & { label: string }>,
): Omit<JsonRequest<BrandFitValue>, "analysisId"> {
  return {
    task: "brand_fit",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts: [
      text(`Creative brief (JSON):\n${briefJson}`),
      image(original.png, original.sha256, "Original ad:"),
      ...variants.map((v) => image(v.png, v.sha256, `${v.label}:`)),
    ],
    schema: BrandFitOutput,
    temperature: TEMPERATURES.brand_fit,
  };
}
