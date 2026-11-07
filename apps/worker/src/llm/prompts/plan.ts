import { PlanBatch, TEMPERATURES, editDslSpec } from "@nologo/core";
import type { z } from "zod";
import type { JsonRequest } from "../client.ts";
import { image, system, text, type ImageRef } from "./shared.ts";

export const PROMPT_VERSION = "plan@1";
export const REPAIR_PROMPT_VERSION = "plan_repair@1";
export type PlanBatchValue = z.infer<typeof PlanBatch>;

const SYSTEM = (allowGenerative: boolean): string => system(`You plan precise edits to an advertisement using ONLY the operations in the Edit DSL below.
You receive: the original ad, the same ad with brand marks hidden, numbered regions with boxes,
measurement results, diagnosis findings, and a creative brief with hard constraints.

Produce exactly 3 plans. Each plan:
- has a one-sentence hypothesis that names the expected effect on brand attribution;
- targets one primary element and states it;
- uses at most 6 operations;
- never touches a locked region and never violates a hard constraint in the brief;
- follows the brief's change budget and preferred directions;
- differs from the other two plans in strategy.
Do not add any brand name or logo. Do not imitate a competitor.

Edit DSL (JSON schema of one plan):
${editDslSpec(allowGenerative)}${allowGenerative ? GENERATIVE_NOTE : ""}`);

const GENERATIVE_NOTE = `

A generative_inpaint op regenerates ONE unlocked region from a text instruction. Use it sparingly (at most one per plan), describe the visual change only, and never ask for text, logos or brand names.`;

export interface PlanInput {
  original: ImageRef;
  masked: ImageRef;
  regionsTable: string;
  metricsSummary: string;
  findingsJson: string;
  briefJson: string;
  allowedPalette: string[];
  allowGenerative?: boolean;
}

export function build(input: PlanInput): Omit<JsonRequest<PlanBatchValue>, "analysisId"> {
  return {
    task: "plan",
    promptVersion: PROMPT_VERSION,
    system: SYSTEM(input.allowGenerative === true),
    parts: [
      image(input.original.png, input.original.sha256, "Original ad:"),
      image(input.masked.png, input.masked.sha256, "Same ad, brand marks hidden:"),
      text(`Regions:\n${input.regionsTable}`),
      text(`Measurements:\n${input.metricsSummary}`),
      text(`Findings (JSON):\n${input.findingsJson}`),
      text(`Creative brief (JSON):\n${input.briefJson}`),
      text(`Allowed palette: ${input.allowedPalette.join(", ") || "(any, subject to the brief)"}`),
    ],
    schema: PlanBatch,
    temperature: TEMPERATURES.plan,
  };
}

// The repair request lists the exact violations (verbatim from validatePlan) next to the original input.
export function buildRepair(
  input: PlanInput,
  violations: string[],
): Omit<JsonRequest<PlanBatchValue>, "analysisId"> {
  const base = build(input);
  return {
    ...base,
    task: "plan_repair",
    promptVersion: REPAIR_PROMPT_VERSION,
    temperature: TEMPERATURES.plan_repair,
    parts: [
      ...base.parts,
      text(`Some plans were invalid. Return all 3 plans again, fixing exactly these violations:\n- ${violations.join("\n- ")}`),
    ],
  };
}
