import { z } from "zod";
import { TEMPERATURES } from "@nologo/core";
import type { JsonRequest } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "leak_check@1";

export const LeakOutput = z.object({
  leaks: z
    .array(
      z.object({
        kind: z.enum(["logo", "brand_name", "packaging_text", "url_or_handle", "other_identifier"]),
        description: z.string().max(120),
        box_2d: z.array(z.number().int().min(0).max(1000)).length(4),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
});
export type LeakOutputValue = z.infer<typeof LeakOutput>;

const SYSTEM = system(`This advertisement has had its brand identifiers covered with flat grey rectangles.
Check whether ANY brand identifier is still visible: a logo, a brand or product name, packaging text,
a website or social handle, or anything else that directly names the brand.
Grey rectangles are intentional; do not report them.
Boxes are [ymin, xmin, ymax, xmax] normalized to 0-1000.`);

export function build(masked: ImageRef): Omit<JsonRequest<LeakOutputValue>, "analysisId"> {
  return {
    task: "leak_check",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts: [text("Advertisement with brand marks hidden:"), image(masked.png, masked.sha256)],
    schema: LeakOutput,
    temperature: TEMPERATURES.leak_check,
  };
}
