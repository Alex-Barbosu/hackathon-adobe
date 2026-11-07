import { z } from "zod";
import { canonicalJson, sha256Text } from "../prng.ts";
import { DirectionTag } from "./pairwise.ts";

// Elements we can ablate, plus cue-only dimensions the panel may cite but v1 cannot remove.
export const ElementOrCue = z.enum([
  "color",
  "mascot_character",
  "product",
  "other_text",
  "layout",
  "typography",
  "photography",
]);
export type ElementOrCueValue = z.infer<typeof ElementOrCue>;

export const ToneAxis = z.number().int().min(-2).max(2);
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const CreativeBrief = z.object({
  version: z.literal(1),
  lockedRegionIds: z.array(z.uuid()),
  lockedElements: z.array(ElementOrCue),
  ownableAssetsRanked: z.array(ElementOrCue).max(5),
  changeBudget: z.number().int().min(1).max(5),
  riskAppetite: z.number().int().min(1).max(5),
  colorFreedom: z.enum(["locked", "palette_only", "open"]),
  palette: z.array(Hex).max(8),
  competitorToEscape: z.uuid().nullable(),
  tone: z.object({ warmPrecise: ToneAxis, playfulPremium: ToneAxis, boldCalm: ToneAxis }),
  audience: z.enum(["existing_customers", "category_newcomers", "both"]).default("both"),
  taboos: z.array(z.string().max(120)).max(10),
  mandatoryCopy: z.array(z.string().max(200)).max(5),
  traitorPolicies: z.array(z.object({ element: ElementOrCue, policy: z.enum(["keep", "replace", "remove"]) })),
  assetEmphasis: z.array(z.object({ element: ElementOrCue, level: z.number().int().min(1).max(5) })),
  // Not in the original spec: answers to the known-brand and generic dynamic questions land here.
  acknowledgements: z
    .object({ knownBrand: z.boolean().optional(), genericEscapePriority: z.number().int().min(1).max(5).optional() })
    .default({}),
  directionPreferences: z.array(z.object({ tag: DirectionTag, score: z.number() })),
  topDirectionIds: z.array(z.uuid()).max(3),
  provenance: z.array(
    z.object({ field: z.string(), questionKey: z.string().nullable(), note: z.string().optional() }),
  ),
});
export type CreativeBriefValue = z.infer<typeof CreativeBrief>;

export interface Provenance {
  field: string;
  questionKey: string | null;
  note?: string;
}

export type BriefFields = Omit<
  CreativeBriefValue,
  "version" | "provenance" | "directionPreferences" | "topDirectionIds"
>;

// What the quiz has collected so far. `filled` lists slots (including dynamic and clarify ones).
export interface BriefDraft {
  fields: Partial<BriefFields>;
  filled: string[];
  provenance: Provenance[];
}

export const emptyDraft = (): BriefDraft => ({ fields: {}, filled: [], provenance: [] });

export interface CompileContext {
  identifierRegionIds: readonly string[];
  directionPreferences: ReadonlyArray<{ tag: string; score: number }>;
  topDirectionIds: readonly string[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Documented defaults for every optional or skipped field.
export function compileBrief(
  draft: BriefDraft,
  ctx: CompileContext,
): { brief: CreativeBriefValue; hash: string } {
  const f = draft.fields;
  const provenance = [...draft.provenance];
  const dflt = <T>(field: keyof BriefFields, value: T): T => {
    if (!(field in f) && !provenance.some((p) => p.field === field)) {
      provenance.push({ field, questionKey: null, note: "default" });
    }
    return value;
  };
  const brief = CreativeBrief.parse({
    version: 1,
    lockedRegionIds: [...new Set([...(f.lockedRegionIds ?? []), ...ctx.identifierRegionIds])].sort(byString),
    lockedElements: [...new Set(f.lockedElements ?? dflt("lockedElements", []))].sort(byString),
    ownableAssetsRanked: f.ownableAssetsRanked ?? dflt("ownableAssetsRanked", []),
    changeBudget: f.changeBudget ?? dflt("changeBudget", 3),
    riskAppetite: f.riskAppetite ?? dflt("riskAppetite", 3),
    colorFreedom: f.colorFreedom ?? dflt("colorFreedom", "palette_only"),
    palette: [...(f.palette ?? dflt("palette", []))].map((h) => h.toLowerCase()).sort(byString),
    competitorToEscape: f.competitorToEscape ?? dflt("competitorToEscape", null),
    tone: f.tone ?? dflt("tone", { warmPrecise: 0, playfulPremium: 0, boldCalm: 0 }),
    audience: f.audience ?? dflt("audience", "both"),
    taboos: f.taboos ?? dflt("taboos", []),
    mandatoryCopy: f.mandatoryCopy ?? dflt("mandatoryCopy", []),
    traitorPolicies: [...(f.traitorPolicies ?? [])].sort((a, b) => byString(a.element, b.element)),
    assetEmphasis: [...(f.assetEmphasis ?? [])].sort((a, b) => byString(a.element, b.element)),
    acknowledgements: f.acknowledgements ?? {},
    directionPreferences: [...ctx.directionPreferences].sort((a, b) => b.score - a.score || byString(a.tag, b.tag)),
    topDirectionIds: [...ctx.topDirectionIds],
    provenance: provenance.sort((a, b) => byString(a.field, b.field)),
  });
  return { brief, hash: sha256Text(canonicalJson(brief)) };
}
