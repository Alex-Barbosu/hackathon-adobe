import { z } from "zod";
import type { Choice, DirectionState } from "./pairwise.ts";
import type { BriefDraft } from "./brief.ts";

export const QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "rank",
  "slider",
  "semantic_pair",
  "palette",
  "short_text",
  "yes_no",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QuizOption = z.object({
  value: z.string(),
  label: z.string(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type QuizOptionValue = z.infer<typeof QuizOption>;

export const QuizConstraints = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
  minSelections: z.number().optional(),
  maxSelections: z.number().optional(),
  allowCustom: z.boolean().optional(),
  maxLength: z.number().optional(),
  axes: z.array(z.object({ key: z.string(), left: z.string(), right: z.string() })).optional(),
  // Data-driven default applied by "Use recommended".
  recommended: z.unknown().optional(),
});
export type QuizConstraintsValue = z.infer<typeof QuizConstraints>;

export const DependsOn = z.object({
  slot: z.string(),
  op: z.enum(["eq", "neq", "in"]),
  value: z.unknown(),
});
export type DependsOnValue = z.infer<typeof DependsOn>;

export interface QuizQuestion {
  id: string;
  key: string;
  source: "core" | "dynamic" | "clarify";
  type: QuestionType;
  prompt: string;
  help: string | null;
  options: QuizOptionValue[];
  constraints: QuizConstraintsValue;
  fillsSlots: string[];
  required: boolean;
  priority: number;
  dependsOn: DependsOnValue | null;
  findingKey: string | null;
  // Template order, used only to break priority ties deterministically.
  order: number;
}

export interface PairwiseState {
  directions: DirectionState[];
  rounds: Array<{ id: string; index: number; aId: string; bId: string; choice: Choice | null }>;
  total: number;
  skipped: boolean;
}

export interface QuizState {
  bank: QuizQuestion[];
  // Answers by question key (including "recommended" answers, flagged separately).
  answers: Record<string, unknown>;
  recommended: string[];
  asked: string[];
  draft: BriefDraft;
  pairwise: PairwiseState;
}

export interface FindingLite {
  findingKey: string;
  rule: string;
  element: string | null;
  brandId: string | null;
  severity: number;
  evidence: Record<string, unknown>;
}

export interface QuizContext {
  identifierRegionIds: string[];
  competitors: Array<{ id: string; name: string; pull: number }>;
  findings: FindingLite[];
  competitorPalettes: Record<string, string[]>;
}

export interface PairwiseStep {
  kind: "pairwise";
  round: {
    id: string | null;
    index: number;
    total: number;
    a: DirectionState;
    b: DirectionState;
  };
}

export type NextStep =
  | { kind: "question"; question: QuizQuestion }
  | PairwiseStep
  | { kind: "ready_to_finish"; summary: { answered: number; requiredLeft: number } };
