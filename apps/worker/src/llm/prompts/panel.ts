import { z } from "zod";
import { TEMPERATURES } from "@nologo/core";
import type { JsonRequest, Part } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "panel@1";

export const PanelOutput = z.object({
  people: z.array(
    z.object({
      person: z.string().describe('"P1".."PK"'),
      scores: z
        .array(
          z.object({
            candidate: z.string().describe('Candidate letter only, e.g. "A"'),
            probability: z.number().min(0).max(1),
          }),
        )
        .min(2),
      cues: z
        .array(
          z.object({
            element: z.enum([
              "color",
              "mascot_character",
              "product",
              "other_text",
              "layout",
              "typography",
              "photography",
              "other",
            ]),
            text: z.string().max(80),
          }),
        )
        .max(4),
      saw_identifier: z.boolean(),
    }),
  ),
});
export type PanelOutputValue = z.infer<typeof PanelOutput>;

const SYSTEM = (k: number): string =>
  system(`You will simulate ${k} different, independent people looking at advertisements.
Each person is described below. Each person has, over the past weeks, seen the labelled ads shown first
(if any are shown). Then each person briefly sees one new ad whose brand marks are hidden by grey rectangles.

For EACH person separately, judge which brand the new ad most likely belongs to, the way that person
would, given only what that person would plausibly notice and remember. People differ: a person who
glances for one second notices less than a person who looks carefully; a heavy category buyer knows
brand codes better than someone who never buys the category.

Give each person a probability for every candidate, including "none of these", summing to about 1.
Also list up to 4 cues that drove that person's judgement, each tagged with the visual element it
belongs to. If a person can still read a brand name or see a logo despite the grey rectangles,
set saw_identifier to true for that person.

Do not make all people agree. Different people should reach different, realistic conclusions.`);

export interface PanelPersona {
  id: string;
  description: string;
  viewing_mode: string;
  category_familiarity: string;
}

export interface PanelExposure extends ImageRef {
  brandLabel: string;
}

export interface PanelInput {
  personas: PanelPersona[];
  // In the order shown to the panel; the "none of these" option is appended last.
  candidates: Array<{ id: string; label: string }>;
  exposures: PanelExposure[];
  test: ImageRef;
}

export interface PanelRequest {
  request: Omit<JsonRequest<PanelOutputValue>, "analysisId">;
  personaByLabel: Record<string, string>;
  letterToKey: Record<string, string>;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function build(input: PanelInput): PanelRequest {
  const personaByLabel: Record<string, string> = {};
  const personaLines = input.personas.map((p, i) => {
    personaByLabel[`P${i + 1}`] = p.id;
    return `P${i + 1}: ${p.description} (viewing: ${p.viewing_mode}; familiarity: ${p.category_familiarity})`;
  });
  const letterToKey: Record<string, string> = {};
  const candidateLines = input.candidates.map((c, i) => {
    const letter = LETTERS[i] ?? "?";
    letterToKey[letter] = c.id;
    return `${letter}: ${c.label}`;
  });
  const noneLetter = LETTERS[input.candidates.length] ?? "?";
  letterToKey[noneLetter] = "none";
  candidateLines.push(`${noneLetter}: none of these`);

  // Order per 9.5: system -> exposures (labelled) -> separator -> test image -> instructions.
  const parts: Part[] = [];
  if (input.exposures.length > 0) {
    parts.push(text("Ads seen earlier by every person:"));
    for (const e of input.exposures) {
      parts.push(image(e.png, e.sha256, `Ad seen earlier — brand: ${e.brandLabel}`));
    }
    parts.push(text("--- End of earlier ads ---"));
  } else {
    parts.push(text("The people have not seen any of these brands' ads before."));
  }
  parts.push(image(input.test.png, input.test.sha256, "Test ad (brand marks hidden):"));
  parts.push(
    text(
      `People:\n${personaLines.join("\n")}\n\nCandidates:\n${candidateLines.join("\n")}\n\nAnswer for every person P1..P${input.personas.length}, giving a probability for every candidate letter.`,
    ),
  );

  return {
    personaByLabel,
    letterToKey,
    request: {
      task: "panel",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM(input.personas.length),
      parts,
      schema: PanelOutput,
      temperature: TEMPERATURES.panel,
      cacheKeyExtra: {
        personas: input.personas.map((p) => p.id).join(","),
        candidates: input.candidates.map((c) => c.id).join(","),
      },
    },
  };
}
