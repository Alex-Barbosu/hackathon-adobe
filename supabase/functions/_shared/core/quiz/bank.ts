import { z } from "zod";
import type { Element } from "../config.ts";
import type { FindingLite, QuizOptionValue, QuizQuestion } from "./types.ts";

export interface BankRegion {
  id: string;
  kind: string;
  label: string | null;
  isIdentifier: boolean;
}

export interface BankImpact {
  element: Element;
  delta: number;
}

export interface BankContext {
  regions: BankRegion[];
  impacts: BankImpact[];
  cueShares: Record<string, number>;
  palette: string[];
  competitors: Array<{ id: string; name: string; pull: number }>;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

type Template = Omit<QuizQuestion, "id" | "order" | "options" | "constraints" | "help"> & {
  help?: string;
  options?: QuizOptionValue[];
  constraints?: QuizQuestion["constraints"];
};

function elementOptions(ctx: BankContext): QuizOptionValue[] {
  const kinds = new Set(ctx.regions.map((r) => r.kind));
  const out: QuizOptionValue[] = [
    { value: "element:color", label: "Colour" },
    { value: "element:layout", label: "Layout / composition" },
  ];
  for (const k of ["mascot_character", "product", "other_text"] as const) {
    if (kinds.has(k)) out.push({ value: `element:${k}`, label: k.replace("_", " ") });
  }
  return out;
}

function ownableOptions(ctx: BankContext): QuizOptionValue[] {
  const scored: Array<{ el: string; delta: number; cue: number }> = ctx.impacts
    .map((i) => ({ el: i.element, delta: i.delta, cue: ctx.cueShares[i.element] ?? 0 }))
    .filter((x) => x.delta > 0 || x.cue >= 0.15);
  for (const extra of ["typography", "photography"]) {
    const cue = ctx.cueShares[extra] ?? 0;
    if (cue > 0) scored.push({ el: extra, delta: 0, cue });
  }
  const chosen = new Set(scored.map((s) => s.el));
  // Rank needs at least two items; top up from the ablatable elements so the question always works.
  for (const i of ctx.impacts) {
    if (chosen.size >= 2) break;
    scored.push({ el: i.element, delta: i.delta, cue: ctx.cueShares[i.element] ?? 0 });
    chosen.add(i.element);
  }
  return scored
    .sort((a, b) => b.delta - a.delta || b.cue - a.cue || (a.el < b.el ? -1 : 1))
    .slice(0, 5)
    .map((s) => ({ value: s.el, label: s.el.replace("_", " "), meta: { delta: s.delta, cueShare: s.cue } }));
}

export const TABOO_PRESETS: QuizOptionValue[] = [
  { value: "no_stock_photo_people", label: "No stock-photo people" },
  { value: "no_discount_badges", label: "No discount badges" },
  { value: "no_dark_backgrounds", label: "No dark backgrounds" },
  { value: "no_celebrity_imagery", label: "No celebrity imagery" },
  { value: "no_clutter", label: "No visual clutter" },
];

// 13.3: the core templates, instantiated from this analysis's data.
export function instantiateCoreQuestions(ctx: BankContext): QuizQuestion[] {
  const editable = ctx.regions.filter((r) => !r.isIdentifier);
  const competitors = [...ctx.competitors].sort((a, b) => b.pull - a.pull || (a.id < b.id ? -1 : 1));
  const ownable = ownableOptions(ctx);
  const templates: Template[] = [
    {
      key: "Q_NON_NEGOTIABLES",
      source: "core",
      type: "multi_choice",
      prompt: "Which of these must never change in any version?",
      help: "Logos, names and other brand identifiers are already locked.",
      options: [
        ...editable.map((r) => ({ value: `region:${r.id}`, label: `${r.label ?? r.kind} (${r.kind})` })),
        ...elementOptions(ctx),
      ],
      constraints: { minSelections: 0, recommended: [] },
      fillsSlots: ["lockedRegionIds", "lockedElements"],
      required: true,
      priority: 100,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_OWNABLE_RANK",
      source: "core",
      type: "rank",
      prompt: "Rank what you want people to recognise you by, long-term.",
      options: ownable,
      constraints: { recommended: ownable.map((o) => o.value) },
      fillsSlots: ["ownableAssetsRanked"],
      required: true,
      priority: 95,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_CHANGE_BUDGET",
      source: "core",
      type: "slider",
      prompt: "How far may a new version move from this ad?",
      constraints: { min: 1, max: 5, minLabel: "Polish", maxLabel: "Reinvention", recommended: 3 },
      fillsSlots: ["changeBudget"],
      required: true,
      priority: 90,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_COLOR_FREEDOM",
      source: "core",
      type: "single_choice",
      prompt: "What can happen to colour?",
      options: [
        { value: "locked", label: "Locked: colours must not change" },
        { value: "palette_only", label: "Brand palette only" },
        { value: "open", label: "Open: any colour" },
      ],
      constraints: { recommended: "palette_only" },
      fillsSlots: ["colorFreedom"],
      required: true,
      priority: 85,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_PALETTE",
      source: "core",
      type: "palette",
      prompt: "Which colours are on-brand?",
      options: ctx.palette.map((hex) => ({ value: hex, label: hex })),
      constraints: { allowCustom: true, maxSelections: 8, recommended: ctx.palette.slice(0, 5) },
      fillsSlots: ["palette"],
      required: true,
      priority: 80,
      dependsOn: { slot: "colorFreedom", op: "eq", value: "palette_only" },
      findingKey: null,
    },
    {
      key: "Q_COMPETITOR_ESCAPE",
      source: "core",
      type: "single_choice",
      prompt: "Who do you most need to stop being mistaken for?",
      options: [
        ...competitors.map((c) => ({ value: c.id, label: `${c.name} — ${pct(c.pull)} of the panel` })),
        { value: "none", label: "No one in particular" },
      ],
      constraints: { recommended: competitors[0]?.id ?? "none" },
      fillsSlots: ["competitorToEscape"],
      required: true,
      priority: 85,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_TONE",
      source: "core",
      type: "semantic_pair",
      prompt: "Where should the ad sit?",
      constraints: {
        min: -2,
        max: 2,
        axes: [
          { key: "warmPrecise", left: "Warm", right: "Precise" },
          { key: "playfulPremium", left: "Playful", right: "Premium" },
          { key: "boldCalm", left: "Bold", right: "Calm" },
        ],
        recommended: { warmPrecise: 0, playfulPremium: 0, boldCalm: 0 },
      },
      fillsSlots: ["tone"],
      required: true,
      priority: 70,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_RISK",
      source: "core",
      type: "slider",
      prompt: "May a version break your category's usual look?",
      constraints: { min: 1, max: 5, minLabel: "Stay conventional", maxLabel: "Break the rules", recommended: 3 },
      fillsSlots: ["riskAppetite"],
      required: true,
      priority: 65,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_AUDIENCE",
      source: "core",
      type: "single_choice",
      prompt: "Who must recognise you?",
      options: [
        { value: "existing_customers", label: "Existing customers" },
        { value: "category_newcomers", label: "Category newcomers" },
        { value: "both", label: "Both" },
      ],
      constraints: { recommended: "both" },
      fillsSlots: ["audience"],
      required: false,
      priority: 40,
      dependsOn: null,
      findingKey: null,
    },
    {
      key: "Q_TABOOS",
      source: "core",
      type: "multi_choice",
      prompt: "Anything we must never do?",
      help: "Pick presets or add your own (up to 120 characters each).",
      options: TABOO_PRESETS,
      constraints: { allowCustom: true, maxSelections: 10, maxLength: 120, recommended: [] },
      fillsSlots: ["taboos"],
      required: false,
      priority: 45,
      dependsOn: null,
      findingKey: null,
    },
  ];
  if (ctx.regions.some((r) => r.kind === "other_text")) {
    templates.push({
      key: "Q_MANDATORY_COPY",
      source: "core",
      type: "short_text",
      prompt: "Any text that must stay exactly as is?",
      help: "One line per phrase, up to 5 lines.",
      constraints: { maxLength: 200, recommended: "" },
      fillsSlots: ["mandatoryCopy"],
      required: false,
      priority: 35,
      dependsOn: null,
      findingKey: null,
    });
  }
  return templates.map((t, order) => ({
    id: t.key,
    order,
    help: t.help ?? null,
    options: t.options ?? [],
    constraints: t.constraints ?? {},
    ...t,
  }));
}

const TraitorOptions: QuizOptionValue[] = [
  { value: "keep", label: "Keep it" },
  { value: "replace", label: "Replace it" },
  { value: "remove", label: "Remove it" },
];

export const DynamicQuestionsOutput = z.object({
  questions: z
    .array(
      z.object({
        finding_key: z.string(),
        slot: z.string(),
        type: z.enum(["single_choice", "multi_choice", "yes_no", "slider"]),
        prompt: z.string().max(220),
        help: z.string().max(200).optional(),
        options: z.array(z.object({ value: z.string().max(40), label: z.string().max(80) })).max(6),
        slider: z
          .object({ min: z.number().int(), max: z.number().int(), min_label: z.string(), max_label: z.string() })
          .optional(),
      }),
    )
    .max(4),
});
export type RawDynamicQuestion = z.infer<typeof DynamicQuestionsOutput>["questions"][number];

// The slots the model may fill, as a function of the findings that exist.
export function allowedDynamicSlots(findings: readonly FindingLite[]): Map<string, FindingLite> {
  const slots = new Map<string, FindingLite>();
  for (const f of findings) {
    if (f.rule === "traitor" && f.element) slots.set(`traitor_policy:${f.element}`, f);
    if (f.rule === "strong_asset" && f.element) slots.set(`asset_emphasis:${f.element}`, f);
    if (f.rule === "known_brand") slots.set("known_brand_ack", f);
    if (f.rule === "generic") slots.set("generic_escape_priority", f);
  }
  return slots;
}

function slotType(slot: string): "single_choice" | "slider" | "yes_no" {
  if (slot.startsWith("traitor_policy:")) return "single_choice";
  if (slot === "known_brand_ack") return "yes_no";
  return "slider";
}

export function dynamicDefault(slot: string): unknown {
  if (slot.startsWith("traitor_policy:")) return "replace";
  if (slot.startsWith("asset_emphasis:")) return 4;
  if (slot === "known_brand_ack") return true;
  return 3;
}

// 10.5 validation: keep only questions whose finding and slot exist and whose type and options fit.
export function validateDynamicQuestions(
  raw: readonly RawDynamicQuestion[],
  findings: readonly FindingLite[],
  startOrder: number,
): { questions: QuizQuestion[]; dropped: string[] } {
  const allowed = allowedDynamicSlots(findings);
  const questions: QuizQuestion[] = [];
  const dropped: string[] = [];
  const usedSlots = new Set<string>();
  for (const q of raw) {
    const finding = allowed.get(q.slot);
    if (!finding || finding.findingKey !== q.finding_key) {
      dropped.push(`${q.slot}: unknown finding or slot not allowed for it`);
      continue;
    }
    if (usedSlots.has(q.slot)) {
      dropped.push(`${q.slot}: duplicate slot`);
      continue;
    }
    if (q.type !== slotType(q.slot)) {
      dropped.push(`${q.slot}: type ${q.type} does not fit the slot`);
      continue;
    }
    const isPolicy = q.slot.startsWith("traitor_policy:");
    const modelValues = new Set(q.options.map((o) => o.value));
    if (isPolicy && !["keep", "replace", "remove"].every((v) => modelValues.has(v)) && modelValues.size > 0) {
      dropped.push(`${q.slot}: option values outside keep/replace/remove`);
      continue;
    }
    usedSlots.add(q.slot);
    const order = startOrder + questions.length;
    questions.push({
      id: `DYN_${questions.length + 1}`,
      key: `DYN_${questions.length + 1}`,
      source: "dynamic",
      type: q.type,
      prompt: q.prompt,
      help: q.help ?? null,
      options: isPolicy ? TraitorOptions : [],
      constraints:
        slotType(q.slot) === "slider"
          ? {
              min: 1,
              max: 5,
              minLabel: q.slider?.min_label ?? "Low",
              maxLabel: q.slider?.max_label ?? "High",
              recommended: dynamicDefault(q.slot),
            }
          : { recommended: dynamicDefault(q.slot) },
      fillsSlots: [q.slot],
      required: false,
      priority: 60 + 8 * finding.severity,
      dependsOn: null,
      findingKey: finding.findingKey,
      order,
    });
  }
  return { questions, dropped };
}
