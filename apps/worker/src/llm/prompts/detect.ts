import { z } from "zod";
import { REGION_KINDS, TEMPERATURES } from "@nologo/core";
import type { JsonRequest } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "detect@1";

export const DetectOutput = z.object({
  regions: z
    .array(
      z.object({
        kind: z.enum(REGION_KINDS),
        label: z.string().max(80).describe('Short description, e.g. "red circular logo top-left"'),
        box_2d: z
          .array(z.number().int().min(0).max(1000))
          .length(4)
          .describe("[ymin, xmin, ymax, xmax] normalized to 0-1000"),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(40),
});
export type DetectOutputValue = z.infer<typeof DetectOutput>;

const SYSTEM = system(`Detect regions in this advertisement. Return every region of these kinds:
- logo: any brand logo, logomark, monogram or emblem
- brand_name: the brand or product name written anywhere, including small print
- packaging_text: brand or product text printed on a package, bottle, can or label
- url_or_handle: website addresses, social handles, hashtags that contain a brand name
- mascot_character: a recurring character, mascot or illustrated figure
- product: the product or package itself (the object, not its text)
- other_text: headlines, taglines, claims, legal copy that do not name the brand
- person: a human model or celebrity
- graphic_element: a distinctive shape, pattern or graphic device
Be exhaustive for logo, brand_name, packaging_text and url_or_handle: missing one ruins the test.
A region may overlap others. Boxes are [ymin, xmin, ymax, xmax] normalized to 0-1000.`);

export function build(img: ImageRef): Omit<JsonRequest<DetectOutputValue>, "analysisId"> {
  return {
    task: "detect",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts: [text("Advertisement:"), image(img.png, img.sha256)],
    schema: DetectOutput,
    temperature: TEMPERATURES.detect,
  };
}
