import { z } from "zod";
import { DIRECTION_TAGS, TEMPERATURES } from "@nologo/core";
import type { JsonRequest } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "directions@1";

export const DirectionsOutput = z.object({
  directions: z
    .array(
      z.object({
        title: z.string().max(60),
        description: z.string().max(240),
        tags: z.array(z.string()).min(1).max(4),
      }),
    )
    .min(6)
    .max(8),
});
export type DirectionsValue = z.infer<typeof DirectionsOutput>;

const SYSTEM = system(`Propose distinct creative directions for improving this advertisement so it is recognised as its own brand
and stands apart from its category. Each direction is a short idea a brand manager can judge in 5 seconds.
Use the diagnosis to ground every direction: amplify real assets, neutralise traitor elements, escape
the competitor that steals attribution. Directions must differ from each other in what they change.
Tag every direction only with tags from the vocabulary provided.`);

export function build(
  findingsJson: string,
  impactsJson: string,
  original: ImageRef,
): Omit<JsonRequest<DirectionsValue>, "analysisId"> {
  return {
    task: "directions",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    parts: [
      text(`Findings (JSON):\n${findingsJson}`),
      text(`Element impacts (JSON):\n${impactsJson}`),
      text(`Tag vocabulary: ${DIRECTION_TAGS.join(", ")}`),
      image(original.png, original.sha256, "The advertisement (original, brand marks visible):"),
    ],
    schema: DirectionsOutput,
    temperature: TEMPERATURES.directions,
  };
}
