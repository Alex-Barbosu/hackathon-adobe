import { PAIRWISE_ROUNDS } from "../config.ts";
import { applyAnswer, validateAnswer } from "./answers.ts";
import { compileBrief, emptyDraft, type CreativeBriefValue } from "./brief.ts";
import { detectContradictions } from "./contradictions.ts";
import {
  applyRound,
  shouldSkipPairwise,
  tagPreferences,
  topDirectionIds,
  type Choice,
  type DirectionState,
} from "./pairwise.ts";
import { requiredLeft, selectNext } from "./select.ts";
import type { QuizContext, QuizQuestion, QuizState } from "./types.ts";

export function initialState(bank: QuizQuestion[], directions: DirectionState[], total = PAIRWISE_ROUNDS): QuizState {
  return {
    bank,
    answers: {},
    recommended: [],
    asked: [],
    draft: emptyDraft(),
    pairwise: { directions, rounds: [], total: Math.min(total, directions.length * (directions.length - 1) / 2), skipped: false },
  };
}

export interface AnswerOutcome {
  state: QuizState;
  errors: string[];
  warnings: string[];
  // Clarifying questions that the answer triggered; the caller persists them.
  newClarify: QuizQuestion[];
}

function questionByKey(state: QuizState, key: string): QuizQuestion {
  const q = state.bank.find((x) => x.key === key);
  if (!q) throw new Error(`Unknown question ${key}`);
  return q;
}

export function answerQuestion(
  state: QuizState,
  key: string,
  value: unknown,
  ctx: QuizContext,
  opts: { recommended?: boolean } = {},
): AnswerOutcome {
  const q = questionByKey(state, key);
  const errors = validateAnswer(q, value);
  if (errors.length > 0) return { state, errors, warnings: [], newClarify: [] };

  const draft = applyAnswer(state.draft, q, value, ctx, opts);
  const nextState: QuizState = {
    ...state,
    answers: { ...state.answers, [key]: value },
    recommended: opts.recommended
      ? [...new Set([...state.recommended, key])]
      : state.recommended.filter((k) => k !== key),
    asked: state.asked.includes(key) ? state.asked : [...state.asked, key],
    draft,
  };
  const newClarify = detectContradictions(
    draft,
    ctx,
    new Set(nextState.bank.map((b) => b.key)),
    nextState.bank.length,
  );
  const withClarify = { ...nextState, bank: [...nextState.bank, ...newClarify] };
  const warnings = newClarify.map((c) => `Follow-up added: ${c.prompt}`);
  return { state: withClarify, errors: [], warnings, newClarify };
}

export function recommendedValue(q: QuizQuestion): unknown {
  return q.constraints.recommended;
}

export function useRecommended(state: QuizState, key: string, ctx: QuizContext): AnswerOutcome {
  const q = questionByKey(state, key);
  if (q.source === "clarify") return { state, errors: ["clarifying questions need a real answer"], warnings: [], newClarify: [] };
  return answerQuestion(state, key, recommendedValue(q), ctx, { recommended: true });
}

export function addRound(state: QuizState, round: { id: string; aId: string; bId: string }): QuizState {
  if (state.pairwise.rounds.some((r) => r.id === round.id)) return state;
  const index = state.pairwise.rounds.length;
  return {
    ...state,
    pairwise: { ...state.pairwise, rounds: [...state.pairwise.rounds, { ...round, index, choice: null }] },
  };
}

export function answerPairwise(state: QuizState, roundId: string, choice: Choice): QuizState {
  const round = state.pairwise.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error(`Unknown round ${roundId}`);
  // Re-answering replays from scratch so Elo never double-counts a round.
  const rounds = state.pairwise.rounds.map((r) => (r.id === roundId ? { ...r, choice } : r));
  let directions = state.pairwise.directions.map((d) => ({ ...d, elo: 1000, comparisons: 0 }));
  for (const r of rounds) if (r.choice) directions = applyRound(directions, r, r.choice);
  return { ...state, pairwise: { ...state.pairwise, rounds, directions } };
}

export function canFinish(state: QuizState): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const left = requiredLeft(state);
  if (left > 0) reasons.push(`${left} required question(s) still open`);
  const step = selectNext(state);
  if (step.kind === "pairwise") reasons.push("pairwise rounds still open");
  if (step.kind === "question" && left === 0) {
    // Optional questions never block finishing.
  }
  return { ok: reasons.length === 0, reasons };
}

export function finishBrief(
  state: QuizState,
  ctx: QuizContext,
): { brief: CreativeBriefValue; hash: string } {
  const check = canFinish(state);
  if (!check.ok) throw new Error(`Cannot finish: ${check.reasons.join("; ")}`);
  const answered = state.pairwise.rounds.filter((r) => r.choice !== null);
  const skip = state.pairwise.skipped || shouldSkipPairwise(state.draft.fields.changeBudget, false);
  return compileBrief(state.draft, {
    identifierRegionIds: ctx.identifierRegionIds,
    directionPreferences: skip ? [] : tagPreferences(state.pairwise.directions, answered),
    topDirectionIds: skip ? [] : topDirectionIds(state.pairwise.directions),
  });
}
