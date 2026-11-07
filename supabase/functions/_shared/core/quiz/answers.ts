import { hexDeltaE } from "../color.ts";
import type { BriefDraft, BriefFields, ElementOrCueValue } from "./brief.ts";
import { ElementOrCue } from "./brief.ts";
import type { QuizContext, QuizQuestion } from "./types.ts";

const HEX = /^#[0-9a-f]{6}$/i;
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);

// Returns a list of problems; empty means the value is acceptable for this question.
export function validateAnswer(q: QuizQuestion, value: unknown): string[] {
  const optionValues = new Set(q.options.map((o) => o.value));
  const c = q.constraints;
  switch (q.type) {
    case "single_choice":
      return isStr(value) && optionValues.has(value) ? [] : ["value must be one of the options"];
    case "yes_no":
      return typeof value === "boolean" ? [] : ["value must be true or false"];
    case "slider": {
      const min = c.min ?? 1;
      const max = c.max ?? 5;
      return isInt(value) && value >= min && value <= max ? [] : [`value must be an integer in ${min}..${max}`];
    }
    case "multi_choice": {
      if (!isStrArray(value)) return ["value must be a list of strings"];
      const problems: string[] = [];
      if (new Set(value).size !== value.length) problems.push("duplicate selections");
      for (const v of value) {
        if (optionValues.has(v)) continue;
        if (!c.allowCustom) problems.push(`"${v}" is not an option`);
        else if (v.length === 0 || v.length > (c.maxLength ?? 120)) problems.push("custom text length out of range");
      }
      if (value.length < (c.minSelections ?? 0)) problems.push(`select at least ${c.minSelections}`);
      if (value.length > (c.maxSelections ?? 99)) problems.push(`select at most ${c.maxSelections}`);
      return problems;
    }
    case "rank": {
      if (!isStrArray(value)) return ["value must be an ordered list of strings"];
      const problems: string[] = [];
      if (new Set(value).size !== value.length) problems.push("duplicate items");
      if (!value.every((v) => optionValues.has(v))) problems.push("items must come from the options");
      if (value.length < Math.min(2, optionValues.size)) problems.push("rank at least two items");
      return problems;
    }
    case "semantic_pair": {
      if (typeof value !== "object" || value === null) return ["value must be an object"];
      const rec = value as Record<string, unknown>;
      const axes = c.axes ?? [];
      return axes.every((a) => isInt(rec[a.key]) && (rec[a.key] as number) >= -2 && (rec[a.key] as number) <= 2)
        ? []
        : ["every axis must be an integer in -2..2"];
    }
    case "palette": {
      if (!isStrArray(value)) return ["value must be a list of hex colours"];
      if (value.length === 0 || value.length > (c.maxSelections ?? 8)) return ["choose 1 to 8 colours"];
      return value.every((v) => HEX.test(v)) ? [] : ["colours must be #rrggbb"];
    }
    case "short_text": {
      if (!isStr(value)) return ["value must be text"];
      const lines = value.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 5) return ["at most 5 lines"];
      return lines.every((l) => l.length <= (c.maxLength ?? 200)) ? [] : ["each line must be at most 200 characters"];
    }
  }
}

export interface ApplyResult {
  draft: BriefDraft;
}

const asElement = (v: string): ElementOrCueValue | null => {
  const p = ElementOrCue.safeParse(v);
  return p.success ? p.data : null;
};

function mark(draft: BriefDraft, slot: string, questionKey: string, note?: string): void {
  if (!draft.filled.includes(slot)) draft.filled.push(slot);
  draft.provenance = draft.provenance.filter((p) => p.field !== slot);
  draft.provenance.push(note ? { field: slot, questionKey, note } : { field: slot, questionKey });
}

function upsert<T extends { element: ElementOrCueValue }>(list: T[] | undefined, item: T): T[] {
  return [...(list ?? []).filter((x) => x.element !== item.element), item];
}

// Pure patch of the draft for one slot. Unknown slots are a programming error, so they throw.
function applySlot(
  draft: BriefDraft,
  slot: string,
  value: unknown,
  q: QuizQuestion,
  ctx: QuizContext,
): void {
  const f: Partial<BriefFields> = draft.fields;
  if (slot === "lockedRegionIds" || slot === "lockedElements") {
    const picks = value as string[];
    f.lockedRegionIds = picks.filter((p) => p.startsWith("region:")).map((p) => p.slice(7));
    f.lockedElements = picks
      .filter((p) => p.startsWith("element:"))
      .map((p) => asElement(p.slice(8)))
      .filter((e): e is ElementOrCueValue => e !== null);
  } else if (slot === "ownableAssetsRanked") {
    f.ownableAssetsRanked = (value as string[]).map(asElement).filter((e): e is ElementOrCueValue => e !== null);
  } else if (slot === "changeBudget") f.changeBudget = value as number;
  else if (slot === "riskAppetite") f.riskAppetite = value as number;
  else if (slot === "colorFreedom") f.colorFreedom = value as BriefFields["colorFreedom"];
  else if (slot === "palette") f.palette = (value as string[]).map((h) => h.toLowerCase());
  else if (slot === "competitorToEscape") f.competitorToEscape = value === "none" ? null : (value as string);
  else if (slot === "tone") f.tone = value as BriefFields["tone"];
  else if (slot === "audience") f.audience = value as BriefFields["audience"];
  else if (slot === "taboos") f.taboos = value as string[];
  else if (slot === "mandatoryCopy") {
    f.mandatoryCopy = (value as string).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  } else if (slot.startsWith("traitor_policy:")) {
    const el = asElement(slot.slice("traitor_policy:".length));
    if (el) f.traitorPolicies = upsert(f.traitorPolicies, { element: el, policy: value as "keep" | "replace" | "remove" });
  } else if (slot.startsWith("asset_emphasis:")) {
    const el = asElement(slot.slice("asset_emphasis:".length));
    if (el) f.assetEmphasis = upsert(f.assetEmphasis, { element: el, level: value as number });
  } else if (slot === "known_brand_ack") {
    f.acknowledgements = { ...(f.acknowledgements ?? {}), knownBrand: value as boolean };
  } else if (slot === "generic_escape_priority") {
    f.acknowledgements = { ...(f.acknowledgements ?? {}), genericEscapePriority: value as number };
  } else if (slot.startsWith("clarify:")) {
    applyClarify(draft, slot, value, ctx);
  } else {
    throw new Error(`Unknown quiz slot "${slot}" on question ${q.key}`);
  }
}

function applyClarify(draft: BriefDraft, slot: string, value: unknown, ctx: QuizContext): void {
  const f: Partial<BriefFields> = draft.fields;
  const [, rule, arg] = slot.split(":");
  if (rule === "LOCKED_COLOR_VS_TRAITOR") {
    if (value === true) f.traitorPolicies = upsert(f.traitorPolicies, { element: "color", policy: "keep" });
    else f.colorFreedom = "palette_only";
  } else if (rule === "LOCKED_AND_REMOVE") {
    const el = asElement(arg ?? "");
    if (!el) throw new Error(`Bad clarify slot ${slot}`);
    if (value === "keep_locked") f.traitorPolicies = upsert(f.traitorPolicies, { element: el, policy: "keep" });
    else f.lockedElements = (f.lockedElements ?? []).filter((e) => e !== el);
  } else if (rule === "SMALL_BUDGET_HIGH_RISK") {
    if (value === true) f.changeBudget = 3;
    else f.riskAppetite = 3;
  } else if (rule === "ESCAPE_BUT_SHARED_PALETTE") {
    if (value === false) {
      const rival = f.competitorToEscape ? ctx.competitorPalettes[f.competitorToEscape] ?? [] : [];
      f.palette = (f.palette ?? []).filter((h) => rival.every((r) => hexDeltaE(h, r) >= 10));
    }
  } else if (rule === "NOTHING_OWNABLE") {
    const el = asElement(String(value));
    if (el) f.ownableAssetsRanked = [el];
  } else {
    throw new Error(`Unknown clarify rule ${String(rule)}`);
  }
}

// Answering again replaces the earlier answer's effect on the draft slot-by-slot.
export function applyAnswer(
  draft: BriefDraft,
  q: QuizQuestion,
  value: unknown,
  ctx: QuizContext,
  opts: { recommended?: boolean } = {},
): BriefDraft {
  const next: BriefDraft = {
    fields: { ...draft.fields },
    filled: [...draft.filled],
    provenance: [...draft.provenance],
  };
  for (const slot of q.fillsSlots) {
    applySlot(next, slot, value, q, ctx);
    mark(next, slot, q.key, opts.recommended ? "default" : undefined);
  }
  return next;
}
