import { MAX_QUESTIONS, OPTIONAL_MIN_PRIORITY, SOFT_LIMIT } from "../config.ts";
import type { BriefDraft } from "./brief.ts";
import { pairKey, selectPair, shouldSkipPairwise } from "./pairwise.ts";
import type { DependsOnValue, NextStep, QuizQuestion, QuizState } from "./types.ts";

function slotValue(draft: BriefDraft, slot: string): unknown {
  return (draft.fields as Record<string, unknown>)[slot];
}

export function dependencySatisfied(dep: DependsOnValue | null, draft: BriefDraft): boolean {
  if (!dep) return true;
  const v = slotValue(draft, dep.slot);
  if (v === undefined) return false;
  if (dep.op === "eq") return v === dep.value;
  if (dep.op === "neq") return v !== dep.value;
  return Array.isArray(dep.value) && dep.value.includes(v);
}

export function allSlotsFilled(slots: readonly string[], draft: BriefDraft): boolean {
  return slots.length > 0 && slots.every((s) => draft.filled.includes(s));
}

const pickHighest = (qs: readonly QuizQuestion[]): QuizQuestion =>
  [...qs].sort((a, b) => b.priority - a.priority || a.order - b.order || (a.key < b.key ? -1 : 1))[0] as QuizQuestion;

export function openQuestions(state: QuizState): QuizQuestion[] {
  const answered = new Set(state.asked);
  return state.bank.filter(
    (q) =>
      !answered.has(q.key) && dependencySatisfied(q.dependsOn, state.draft) && !allSlotsFilled(q.fillsSlots, state.draft),
  );
}

export function requiredLeft(state: QuizState): number {
  return openQuestions(state).filter((q) => q.required || q.source === "clarify").length;
}

function toPairwiseOrFinish(state: QuizState): NextStep {
  const p = state.pairwise;
  const answered = p.rounds.filter((r) => r.choice !== null).length;
  const skip = p.skipped || shouldSkipPairwise(state.draft.fields.changeBudget, false);
  if (!skip && answered < p.total) {
    const open = p.rounds.find((r) => r.choice === null);
    const byId = new Map(p.directions.map((d) => [d.id, d]));
    if (open) {
      const a = byId.get(open.aId);
      const b = byId.get(open.bId);
      if (a && b) return { kind: "pairwise", round: { id: open.id, index: open.index, total: p.total, a, b } };
    } else {
      const shown = new Set(p.rounds.map((r) => pairKey(r.aId, r.bId)));
      const pair = selectPair(p.directions, shown);
      if (pair) {
        return { kind: "pairwise", round: { id: null, index: p.rounds.length, total: p.total, a: pair[0], b: pair[1] } };
      }
    }
  }
  return { kind: "ready_to_finish", summary: { answered: state.asked.length, requiredLeft: requiredLeft(state) } };
}

// Pure and deterministic: the same session state always gives the same next step.
export function selectNext(state: QuizState): NextStep {
  if (state.asked.length >= MAX_QUESTIONS) return toPairwiseOrFinish(state);
  const open = openQuestions(state);

  const clarify = open.filter((q) => q.source === "clarify");
  if (clarify.length > 0) return { kind: "question", question: pickHighest(clarify) };

  const required = open.filter((q) => q.required);
  if (required.length > 0) return { kind: "question", question: pickHighest(required) };

  const optional = open.filter((q) => q.priority >= OPTIONAL_MIN_PRIORITY);
  if (optional.length > 0 && state.asked.length < SOFT_LIMIT) {
    return { kind: "question", question: pickHighest(optional) };
  }
  return toPairwiseOrFinish(state);
}
