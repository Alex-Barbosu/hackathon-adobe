import { hexDeltaE } from "../color.ts";
import type { BriefDraft } from "./brief.ts";
import type { QuizContext, QuizQuestion } from "./types.ts";

export const CLARIFY_PRIORITY = 200;

type RuleCheck = (draft: BriefDraft, ctx: QuizContext) => QuizQuestion[];

const yesNo = (
  rule: string,
  prompt: string,
  order: number,
  arg?: string,
  options?: QuizQuestion["options"],
): QuizQuestion => {
  const key = `CLARIFY_${rule}${arg ? `_${arg}` : ""}`;
  return {
    id: key,
    key,
    source: "clarify",
    type: options ? "single_choice" : "yes_no",
    prompt,
    help: null,
    options: options ?? [],
    constraints: {},
    fillsSlots: [`clarify:${rule}${arg ? `:${arg}` : ""}`],
    required: false,
    priority: CLARIFY_PRIORITY,
    dependsOn: null,
    findingKey: null,
    order,
  };
};

const nameOf = (ctx: QuizContext, id: string | null | undefined): string =>
  ctx.competitors.find((c) => c.id === id)?.name ?? "a competitor";

const policyFor = (draft: BriefDraft, el: string): string | undefined =>
  draft.fields.traitorPolicies?.find((p) => p.element === el)?.policy;

const RULES: Array<{ rule: string; check: RuleCheck }> = [
  {
    rule: "LOCKED_COLOR_VS_TRAITOR",
    check: (draft, ctx) => {
      const traitor = ctx.findings.find((f) => f.rule === "traitor" && f.element === "color");
      const policy = policyFor(draft, "color");
      if (draft.fields.colorFreedom !== "locked" || !traitor || (policy !== "replace" && policy !== "remove")) return [];
      return [
        yesNo(
          "LOCKED_COLOR_VS_TRAITOR",
          `You locked colour, but colour is what makes people think of ${nameOf(ctx, traitor.brandId)}. Keep colour locked anyway?`,
          0,
        ),
      ];
    },
  },
  {
    rule: "LOCKED_AND_REMOVE",
    check: (draft) =>
      (draft.fields.lockedElements ?? [])
        .filter((el) => policyFor(draft, el) === "remove")
        .map((el) =>
          yesNo(
            "LOCKED_AND_REMOVE",
            `${el.replace("_", " ")} is marked must-not-change and to-be-removed. Which one is right?`,
            0,
            el,
            [
              { value: "keep_locked", label: "Keep it, do not change it" },
              { value: "allow_removal", label: "Allow removing it" },
            ],
          ),
        ),
  },
  {
    rule: "SMALL_BUDGET_HIGH_RISK",
    check: (draft) =>
      (draft.fields.changeBudget ?? 5) <= 2 && (draft.fields.riskAppetite ?? 1) >= 4
        ? [
            yesNo(
              "SMALL_BUDGET_HIGH_RISK",
              "You asked for small changes that break category conventions. Should we allow bigger changes?",
              0,
            ),
          ]
        : [],
  },
  {
    rule: "ESCAPE_BUT_SHARED_PALETTE",
    check: (draft, ctx) => {
      const rival = draft.fields.competitorToEscape;
      if (!rival || draft.fields.colorFreedom !== "palette_only") return [];
      const rivalColors = ctx.competitorPalettes[rival] ?? [];
      const shared = (draft.fields.palette ?? []).some((h) => rivalColors.some((r) => hexDeltaE(h, r) < 10));
      return shared
        ? [
            yesNo(
              "ESCAPE_BUT_SHARED_PALETTE",
              `Your palette includes a colour viewers link to ${nameOf(ctx, rival)}. Keep it?`,
              0,
            ),
          ]
        : [];
    },
  },
  {
    rule: "NOTHING_OWNABLE",
    check: (draft, ctx) => {
      const ranked = draft.fields.ownableAssetsRanked;
      if (!ranked) return [];
      const decoration = new Set(ctx.findings.filter((f) => f.rule === "decoration").map((f) => f.element));
      if (ranked.length > 0 && !ranked.every((e) => decoration.has(e))) return [];
      return [
        yesNo(
          "NOTHING_OWNABLE",
          "None of the elements you ranked currently carries your brand. Which one should we try to build up?",
          0,
          undefined,
          [
            { value: "color", label: "Colour" },
            { value: "mascot_character", label: "Mascot / character" },
            { value: "product", label: "Product" },
            { value: "layout", label: "Layout" },
          ],
        ),
      ];
    },
  },
];

// Each rule fires at most once per key per session: callers pass the keys already in the bank.
export function detectContradictions(
  draft: BriefDraft,
  ctx: QuizContext,
  existingKeys: ReadonlySet<string>,
  startOrder: number,
): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const { check } of RULES) {
    for (const q of check(draft, ctx)) {
      if (existingKeys.has(q.key) || out.some((o) => o.key === q.key)) continue;
      out.push({ ...q, order: startOrder + out.length });
    }
  }
  return out;
}
