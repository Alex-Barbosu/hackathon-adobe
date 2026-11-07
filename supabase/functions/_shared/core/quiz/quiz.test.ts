import { describe, expect, it } from "vitest";
import { instantiateCoreQuestions, validateDynamicQuestions, type BankContext, type RawDynamicQuestion } from "./bank.ts";
import { validateAnswer } from "./answers.ts";
import { compileBrief, emptyDraft } from "./brief.ts";
import { detectContradictions } from "./contradictions.ts";
import { addRound, answerPairwise, answerQuestion, canFinish, finishBrief, initialState, useRecommended } from "./engine.ts";
import {
  applyRound, cleanDirections, levenshteinRatio, pairKey, selectPair, shouldSkipPairwise, tagPreferences, topDirectionIds,
  type DirectionState,
} from "./pairwise.ts";
import { selectNext } from "./select.ts";
import type { FindingLite, NextStep, QuizContext, QuizState } from "./types.ts";

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COMP1 = uuid(101);
const COMP2 = uuid(102);

const bankCtx: BankContext = {
  regions: [
    { id: uuid(1), kind: "logo", label: "logo", isIdentifier: true },
    { id: uuid(2), kind: "mascot_character", label: "yellow bird", isIdentifier: false },
    { id: uuid(3), kind: "product", label: "bottle", isIdentifier: false },
    { id: uuid(4), kind: "other_text", label: "tagline", isIdentifier: false },
  ],
  impacts: [
    { element: "color", delta: 0.05 },
    { element: "mascot_character", delta: 0.4 },
    { element: "product", delta: -0.01 },
    { element: "other_text", delta: 0 },
    { element: "layout", delta: 0.02 },
  ],
  cueShares: { mascot_character: 0.7, color: 0.5, typography: 0.2 },
  palette: ["#ffcc00", "#112233", "#fafafa"],
  competitors: [
    { id: COMP1, name: "Brand X", pull: 0.44 },
    { id: COMP2, name: "Brand Y", pull: 0.1 },
  ],
};

const findings: FindingLite[] = [
  { findingKey: `traitor:color:${COMP1}`, rule: "traitor", element: "color", brandId: COMP1, severity: 4, evidence: {} },
  { findingKey: "strong_asset:mascot_character", rule: "strong_asset", element: "mascot_character", brandId: null, severity: 5, evidence: {} },
  { findingKey: "generic", rule: "generic", element: null, brandId: null, severity: 3, evidence: {} },
];

const ctx: QuizContext = {
  identifierRegionIds: [uuid(1)],
  competitors: bankCtx.competitors,
  findings,
  competitorPalettes: { [COMP1]: ["#ffcc00"], [COMP2]: ["#00ff00"] },
};

const dyn = (over: Partial<RawDynamicQuestion>): RawDynamicQuestion => ({
  finding_key: `traitor:color:${COMP1}`,
  slot: "traitor_policy:color",
  type: "single_choice",
  prompt: "44% of viewers link your colour to Brand X. What should we do?",
  options: [
    { value: "keep", label: "Keep" },
    { value: "replace", label: "Replace" },
    { value: "remove", label: "Remove" },
  ],
  ...over,
});

const directions = (n = 6): DirectionState[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(200 + i),
    title: `Direction ${i}`,
    description: "d",
    tags: [["amplify_mascot", "own_a_color"], ["more_whitespace"], ["warmer_tone", "amplify_product"]][i % 3]!,
    elo: 1000,
    comparisons: 0,
  }));

function freshState(): QuizState {
  const core = instantiateCoreQuestions(bankCtx);
  const { questions } = validateDynamicQuestions(
    [
      dyn({}),
      dyn({
        finding_key: "strong_asset:mascot_character",
        slot: "asset_emphasis:mascot_character",
        type: "slider",
        options: [],
        slider: { min: 1, max: 5, min_label: "Low", max_label: "High" },
        prompt: "Your mascot lifts recognition by 40%. How hard should we lean on it?",
      }),
    ],
    findings,
    core.length,
  );
  return initialState([...core, ...questions], directions());
}

function step(state: QuizState): NextStep {
  return selectNext(state);
}

describe("bank", () => {
  it("instantiates core templates from data", () => {
    const bank = instantiateCoreQuestions(bankCtx);
    const keys = bank.map((q) => q.key);
    expect(keys).toContain("Q_PALETTE");
    expect(keys).toContain("Q_MANDATORY_COPY");
    const escape = bank.find((q) => q.key === "Q_COMPETITOR_ESCAPE")!;
    expect(escape.options[0]?.label).toBe("Brand X — 44% of the panel");
    expect(escape.constraints.recommended).toBe(COMP1);
    const nn = bank.find((q) => q.key === "Q_NON_NEGOTIABLES")!;
    expect(nn.options.some((o) => o.value === `region:${uuid(1)}`)).toBe(false);
    expect(bank.find((q) => q.key === "Q_OWNABLE_RANK")!.options[0]?.value).toBe("mascot_character");
  });
  it("omits mandatory copy when there are no text regions", () => {
    const bank = instantiateCoreQuestions({ ...bankCtx, regions: bankCtx.regions.filter((r) => r.kind !== "other_text") });
    expect(bank.map((q) => q.key)).not.toContain("Q_MANDATORY_COPY");
  });
  it("validates dynamic questions and prices them by severity", () => {
    const r = validateDynamicQuestions(
      [
        dyn({}),
        dyn({ slot: "traitor_policy:layout" }),
        dyn({ finding_key: "nope" }),
        dyn({ type: "yes_no" }),
        dyn({ options: [{ value: "x", label: "x" }] }),
        dyn({}),
      ],
      findings,
      0,
    );
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]?.priority).toBe(60 + 8 * 4);
    expect(r.dropped).toHaveLength(5);
  });
});

describe("select", () => {
  it("asks required questions by priority and skips palette until colour is palette_only", () => {
    let s = freshState();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = step(s);
      if (n.kind !== "question") break;
      order.push(n.question.key);
      s = useRecommended(s, n.question.key, ctx).state;
    }
    expect(order[0]).toBe("Q_NON_NEGOTIABLES");
    expect(order[1]).toBe("Q_OWNABLE_RANK");
    let locked = freshState();
    locked = answerQuestion(locked, "Q_COLOR_FREEDOM", "locked", ctx).state;
    const keys: string[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const n = step(locked);
      if (n.kind !== "question") break;
      keys.push(n.question.key);
      locked = useRecommended(locked, n.question.key, ctx).state;
    }
    expect(keys).not.toContain("Q_PALETTE");
  });
  it("is deterministic", () => {
    expect(JSON.stringify(step(freshState()))).toBe(JSON.stringify(step(freshState())));
  });
  it("stops at the question cap", () => {
    const s = freshState();
    const capped = { ...s, asked: Array.from({ length: 12 }, (_, i) => `K${i}`) };
    expect(step(capped).kind).not.toBe("question");
  });
});

describe("answers", () => {
  const q = (key: string) => instantiateCoreQuestions(bankCtx).find((x) => x.key === key)!;
  it("validates each type", () => {
    expect(validateAnswer(q("Q_COLOR_FREEDOM"), "open")).toEqual([]);
    expect(validateAnswer(q("Q_COLOR_FREEDOM"), "nope")).not.toEqual([]);
    expect(validateAnswer(q("Q_CHANGE_BUDGET"), 3)).toEqual([]);
    expect(validateAnswer(q("Q_CHANGE_BUDGET"), 9)).not.toEqual([]);
    expect(validateAnswer(q("Q_CHANGE_BUDGET"), 2.5)).not.toEqual([]);
    expect(validateAnswer(q("Q_NON_NEGOTIABLES"), ["element:color"])).toEqual([]);
    expect(validateAnswer(q("Q_NON_NEGOTIABLES"), ["element:color", "element:color"])).not.toEqual([]);
    expect(validateAnswer(q("Q_NON_NEGOTIABLES"), ["bogus"])).not.toEqual([]);
    expect(validateAnswer(q("Q_OWNABLE_RANK"), ["mascot_character"])).not.toEqual([]);
    expect(validateAnswer(q("Q_OWNABLE_RANK"), ["mascot_character", "color"])).toEqual([]);
    expect(validateAnswer(q("Q_OWNABLE_RANK"), ["mascot_character", "ghost"])).not.toEqual([]);
    expect(validateAnswer(q("Q_TONE"), { warmPrecise: 1, playfulPremium: -2, boldCalm: 0 })).toEqual([]);
    expect(validateAnswer(q("Q_TONE"), { warmPrecise: 5, playfulPremium: 0, boldCalm: 0 })).not.toEqual([]);
    expect(validateAnswer(q("Q_PALETTE"), ["#ffcc00"])).toEqual([]);
    expect(validateAnswer(q("Q_PALETTE"), ["red"])).not.toEqual([]);
    expect(validateAnswer(q("Q_PALETTE"), [])).not.toEqual([]);
    expect(validateAnswer(q("Q_TABOOS"), ["no_clutter", "never use comic sans"])).toEqual([]);
    expect(validateAnswer(q("Q_TABOOS"), ["x".repeat(200)])).not.toEqual([]);
    expect(validateAnswer(q("Q_MANDATORY_COPY"), "line1\nline2")).toEqual([]);
    expect(validateAnswer(q("Q_MANDATORY_COPY"), "a\nb\nc\nd\ne\nf")).not.toEqual([]);
    expect(validateAnswer(q("Q_MANDATORY_COPY"), 4)).not.toEqual([]);
    const yn = { ...q("Q_AUDIENCE"), type: "yes_no" as const };
    expect(validateAnswer(yn, true)).toEqual([]);
    expect(validateAnswer(yn, "yes")).not.toEqual([]);
  });
  it("rejects an invalid answer without changing state and replaces on re-answer", () => {
    const s = freshState();
    const bad = answerQuestion(s, "Q_CHANGE_BUDGET", 99, ctx);
    expect(bad.errors).not.toEqual([]);
    expect(bad.state).toBe(s);
    const a = answerQuestion(s, "Q_CHANGE_BUDGET", 2, ctx).state;
    const b = answerQuestion(a, "Q_CHANGE_BUDGET", 4, ctx).state;
    expect(b.draft.fields.changeBudget).toBe(4);
    expect(b.asked.filter((k) => k === "Q_CHANGE_BUDGET")).toHaveLength(1);
  });
  it("throws on unknown questions", () => {
    expect(() => answerQuestion(freshState(), "NOPE", 1, ctx)).toThrow();
  });
});

describe("contradictions", () => {
  it("LOCKED_COLOR_VS_TRAITOR fires once and its answer patches the draft", () => {
    let s = freshState();
    s = answerQuestion(s, "Q_COLOR_FREEDOM", "locked", ctx).state;
    const out = answerQuestion(s, "DYN_1", "replace", ctx);
    expect(out.newClarify.map((c) => c.key)).toEqual(["CLARIFY_LOCKED_COLOR_VS_TRAITOR"]);
    expect(out.warnings[0]).toContain("Brand X");
    const n = step(out.state);
    expect(n.kind === "question" && n.question.key).toBe("CLARIFY_LOCKED_COLOR_VS_TRAITOR");
    const again = answerQuestion(out.state, "DYN_1", "replace", ctx);
    expect(again.newClarify).toHaveLength(0);
    const unlocked = answerQuestion(out.state, "CLARIFY_LOCKED_COLOR_VS_TRAITOR", false, ctx).state;
    expect(unlocked.draft.fields.colorFreedom).toBe("palette_only");
    const kept = answerQuestion(out.state, "CLARIFY_LOCKED_COLOR_VS_TRAITOR", true, ctx).state;
    expect(kept.draft.fields.traitorPolicies).toEqual([{ element: "color", policy: "keep" }]);
  });
  it("LOCKED_AND_REMOVE, SMALL_BUDGET_HIGH_RISK, ESCAPE_BUT_SHARED_PALETTE, NOTHING_OWNABLE", () => {
    let s = freshState();
    s = answerQuestion(s, "Q_NON_NEGOTIABLES", ["element:color"], ctx).state;
    const lr = answerQuestion(s, "DYN_1", "remove", ctx);
    expect(lr.newClarify.map((c) => c.key)).toContain("CLARIFY_LOCKED_AND_REMOVE_color");
    expect(answerQuestion(lr.state, "CLARIFY_LOCKED_AND_REMOVE_color", "keep_locked", ctx).state.draft.fields.traitorPolicies).toEqual([
      { element: "color", policy: "keep" },
    ]);
    expect(
      answerQuestion(lr.state, "CLARIFY_LOCKED_AND_REMOVE_color", "allow_removal", ctx).state.draft.fields.lockedElements,
    ).toEqual([]);

    let b = answerQuestion(freshState(), "Q_CHANGE_BUDGET", 2, ctx).state;
    const sb = answerQuestion(b, "Q_RISK", 5, ctx);
    expect(sb.newClarify.map((c) => c.key)).toEqual(["CLARIFY_SMALL_BUDGET_HIGH_RISK"]);
    b = answerQuestion(sb.state, "CLARIFY_SMALL_BUDGET_HIGH_RISK", true, ctx).state;
    expect(b.draft.fields.changeBudget).toBe(3);
    expect(answerQuestion(sb.state, "CLARIFY_SMALL_BUDGET_HIGH_RISK", false, ctx).state.draft.fields.riskAppetite).toBe(3);

    let p = answerQuestion(freshState(), "Q_COLOR_FREEDOM", "palette_only", ctx).state;
    p = answerQuestion(p, "Q_COMPETITOR_ESCAPE", COMP1, ctx).state;
    const ep = answerQuestion(p, "Q_PALETTE", ["#ffcc00", "#112233"], ctx);
    expect(ep.newClarify.map((c) => c.key)).toEqual(["CLARIFY_ESCAPE_BUT_SHARED_PALETTE"]);
    expect(answerQuestion(ep.state, "CLARIFY_ESCAPE_BUT_SHARED_PALETTE", false, ctx).state.draft.fields.palette).toEqual(["#112233"]);

    const no = answerQuestion(freshState(), "Q_OWNABLE_RANK", ["layout", "color"], {
      ...ctx,
      findings: [
        ...findings,
        { findingKey: "decoration:layout", rule: "decoration", element: "layout", brandId: null, severity: 2, evidence: {} },
        { findingKey: "decoration:color", rule: "decoration", element: "color", brandId: null, severity: 2, evidence: {} },
      ],
    });
    expect(no.newClarify.map((c) => c.key)).toEqual(["CLARIFY_NOTHING_OWNABLE"]);
    expect(answerQuestion(no.state, "CLARIFY_NOTHING_OWNABLE", "mascot_character", ctx).state.draft.fields.ownableAssetsRanked).toEqual([
      "mascot_character",
    ]);
    expect(detectContradictions(emptyDraft(), ctx, new Set(), 0)).toEqual([]);
  });
  it("clarifying questions cannot take the recommended default", () => {
    let s = freshState();
    s = answerQuestion(s, "Q_COLOR_FREEDOM", "locked", ctx).state;
    s = answerQuestion(s, "DYN_1", "replace", ctx).state;
    expect(useRecommended(s, "CLARIFY_LOCKED_COLOR_VS_TRAITOR", ctx).errors).not.toEqual([]);
  });
});

describe("pairwise", () => {
  it("selects fresh, close pairs deterministically and never repeats", () => {
    const ds = directions(4);
    const shown = new Set<string>();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = selectPair(ds, shown);
      expect(p).not.toBeNull();
      const k = pairKey(p![0].id, p![1].id);
      expect(shown.has(k)).toBe(false);
      shown.add(k);
      seen.push(k);
    }
    expect(selectPair(ds, shown)).toBeNull();
    expect(new Set(seen).size).toBe(6);
  });
  it("prefers directions with fewer comparisons", () => {
    const ds = directions(3).map((d, i) => (i === 0 ? { ...d, comparisons: 5 } : d));
    const [a, b] = selectPair(ds, new Set())!;
    expect([a.id, b.id]).not.toContain(ds[0]!.id);
  });
  it("updates Elo and tag preferences", () => {
    let ds = directions(3);
    const r = { aId: ds[0]!.id, bId: ds[1]!.id };
    ds = applyRound(ds, r, "a");
    expect(ds[0]!.elo).toBe(1016);
    expect(ds[1]!.elo).toBe(984);
    const prefs = tagPreferences(ds, [{ id: "r", index: 0, ...r, choice: "a" }]);
    expect(prefs.find((p) => p.tag === "amplify_mascot")?.score).toBe(1);
    expect(prefs.find((p) => p.tag === "more_whitespace")?.score).toBe(-1);
    const neither = tagPreferences(ds, [{ id: "r", index: 0, ...r, choice: "neither" }]);
    expect(neither.every((p) => p.score === -0.5)).toBe(true);
    expect(applyRound(ds, r, "b")[1]!.elo).toBeGreaterThan(984);
    expect(applyRound(ds, r, "neither")[0]!.elo).toBeLessThan(1016);
    expect(topDirectionIds(ds)).toEqual([ds[0]!.id]);
    expect(() => applyRound(ds, { aId: "x", bId: "y" }, "a")).toThrow();
  });
  it("skips pairwise for polish-only briefs and cleans direction pools", () => {
    expect(shouldSkipPairwise(1, false)).toBe(true);
    expect(shouldSkipPairwise(1, true)).toBe(false);
    expect(shouldSkipPairwise(3, false)).toBe(false);
    expect(levenshteinRatio("abc", "abc")).toBe(0);
    expect(levenshteinRatio("", "abc")).toBe(1);
    const { kept, dropped } = cleanDirections([
      { title: "Bold yellow frame", description: "d", tags: ["brand_band_or_frame", "bogus_tag"] },
      { title: "Bold yellow frames", description: "d", tags: ["own_a_color"] },
      { title: "Quiet type", description: "d", tags: ["bogus_tag"] },
      { title: "Hero the bird", description: "d", tags: ["amplify_mascot"] },
    ]);
    expect(kept.map((k) => k.title)).toEqual(["Bold yellow frame", "Hero the bird"]);
    expect(kept[0]?.tags).toEqual(["brand_band_or_frame"]);
    expect(dropped).toHaveLength(2);
  });
});

function runSession(budget: number, choices: Array<"a" | "b" | "neither">) {
  let s = freshState();
  s = answerQuestion(s, "Q_CHANGE_BUDGET", budget, ctx).state;
  let round = 0;
  for (let guard = 0; guard < 60; guard++) {
    const n = step(s);
    if (n.kind === "question") {
      const out = useRecommended(s, n.question.key, ctx);
      if (out.errors.length > 0) {
        s = answerQuestion(s, n.question.key, n.question.type === "yes_no" ? true : n.question.options[0]?.value ?? "keep_locked", ctx).state;
      } else s = out.state;
    } else if (n.kind === "pairwise") {
      let id = n.round.id;
      if (!id) {
        id = uuid(900 + round);
        s = addRound(s, { id, aId: n.round.a.id, bId: n.round.b.id });
      }
      s = answerPairwise(s, id, choices[round++ % choices.length]!);
    } else break;
  }
  return s;
}

describe("full simulated session", () => {
  it("runs to a valid brief with provenance and pairwise results", () => {
    const s = runSession(3, ["a", "b", "a"]);
    expect(canFinish(s)).toEqual({ ok: true, reasons: [] });
    const { brief, hash } = finishBrief(s, ctx);
    expect(brief.changeBudget).toBe(3);
    expect(brief.lockedRegionIds).toContain(uuid(1));
    expect(brief.directionPreferences.length).toBeGreaterThan(0);
    expect(brief.topDirectionIds.length).toBeGreaterThan(0);
    expect(brief.assetEmphasis[0]?.element).toBe("mascot_character");
    expect(brief.provenance.find((p) => p.field === "changeBudget")?.questionKey).toBe("Q_CHANGE_BUDGET");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(finishBrief(runSession(3, ["a", "b", "a"]), ctx).hash).toBe(hash);
    expect(s.asked.length).toBeLessThanOrEqual(12);
  });
  it("skips pairwise for change budget 1 and different budgets give different briefs", () => {
    const polish = runSession(1, ["a"]);
    expect(polish.pairwise.rounds).toHaveLength(0);
    const b1 = finishBrief(polish, ctx);
    const b5 = finishBrief(runSession(5, ["b"]), ctx);
    expect(b1.hash).not.toBe(b5.hash);
    expect(b1.brief.directionPreferences).toEqual([]);
  });
  it("refuses to finish with open required questions", () => {
    const s = freshState();
    expect(canFinish(s).ok).toBe(false);
    expect(() => finishBrief(s, ctx)).toThrow();
  });
  it("compileBrief fills documented defaults and marks them", () => {
    const { brief } = compileBrief(emptyDraft(), { identifierRegionIds: [uuid(1)], directionPreferences: [], topDirectionIds: [] });
    expect(brief.audience).toBe("both");
    expect(brief.changeBudget).toBe(3);
    expect(brief.provenance.find((p) => p.field === "changeBudget")?.note).toBe("default");
  });
});
