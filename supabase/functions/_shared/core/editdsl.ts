import { z } from "zod";
import { hexDeltaE } from "./color.ts";
import { area, intersection, type NormBox, norm } from "./boxes.ts";
import type { CreativeBriefValue } from "./quiz/brief.ts";
import { DirectionTag } from "./quiz/pairwise.ts";

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const regionId = z.string().describe('Region id as listed to you, e.g. "R1"');

// Text overlays are intentionally absent in v1: fonts, legibility and accidental brand names
// are hard to guarantee (see ADR in docs/DECISIONS.md).
export const EditOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("recolor_region"),
    regionId,
    targetHex: Hex,
    toleranceDE: z
      .number()
      .min(5)
      .max(40)
      .describe("Pixels within this DeltaE of the region's dominant colour are recoloured; luminance is preserved"),
  }),
  z.object({
    op: z.literal("change_background"),
    targetHex: Hex,
    toleranceDE: z.number().min(5).max(40),
  }),
  z.object({
    op: z.literal("scale_region"),
    regionId,
    factor: z.number().min(0.6).max(1.8),
    anchor: z.enum(["center", "top", "bottom", "left", "right"]),
  }),
  z.object({
    op: z.literal("move_region"),
    regionId,
    dxPct: z.number().min(-40).max(40),
    dyPct: z.number().min(-40).max(40),
  }),
  z.object({ op: z.literal("remove_region"), regionId }),
  z.object({
    op: z.literal("add_band"),
    edge: z.enum(["top", "bottom", "left", "right"]),
    thicknessPct: z.number().min(2).max(15),
    hex: Hex,
  }),
  z.object({
    op: z.literal("tone"),
    saturation: z.number().min(0.6).max(1.4),
    contrast: z.number().min(0.85).max(1.2),
  }),
  // Only available when generative edits are enabled. The renderer sends a crop of this one region to an
  // image model and pastes the result back inside the region, so nothing outside it can change.
  z.object({
    op: z.literal("generative_inpaint"),
    regionId,
    instruction: z
      .string()
      .min(3)
      .max(200)
      .describe("What the region should look like afterwards. Never include a brand name, logo or readable text."),
  }),
]);
export type EditOpValue = z.infer<typeof EditOp>;

export const PrimaryElement = z.enum(["color", "mascot_character", "product", "other_text", "layout"]);

export const EditPlan = z.object({
  title: z.string().max(60),
  hypothesis: z.string().max(240),
  primaryElement: PrimaryElement,
  directionTags: z.array(DirectionTag).max(3),
  ops: z.array(EditOp).min(1).max(6),
});
export type EditPlanValue = z.infer<typeof EditPlan>;

export const PlanBatch = z.object({ plans: z.array(EditPlan).length(3) });

// The spec shown to the planner is generated from the schema so the prompt can never drift from it.
// When generative edits are off, the planner is never told the op exists.
export function editDslSpec(allowGenerative = false): string {
  const schema = z.toJSONSchema(EditPlan) as { properties?: { ops?: { items?: { oneOf?: Array<{ properties?: { op?: { const?: string } } }> } } } };
  const items = schema.properties?.ops?.items;
  if (!allowGenerative && items?.oneOf) {
    items.oneOf = items.oneOf.filter((o) => o.properties?.op?.const !== "generative_inpaint");
  }
  return JSON.stringify(schema, null, 1);
}

// One line per operation listing the fields it REQUIRES, for prompts and repair requests.
export function editOpFieldGuide(allowGenerative = false): string {
  return EditOp.options
    .filter((o) => allowGenerative || o.shape.op.value !== "generative_inpaint")
    .map((o) => `- ${o.shape.op.value}: ${Object.keys(o.shape).filter((k) => k !== "op").join(", ")}`)
    .join("\n");
}

export interface PlanRegion {
  // The "R1".."Rn" id shown to the planner.
  ref: string;
  kind: string;
  box: NormBox;
  locked: boolean;
  isIdentifier: boolean;
}

export interface PlanContext {
  regions: PlanRegion[];
  brief: CreativeBriefValue;
  // Colours that viewers associate with the competitor to escape.
  escapeColors: string[];
  // Defaults to false: generative plans are rejected unless the deployment enabled them.
  generativeEnabled?: boolean;
}

const REGION_OPS = new Set(["recolor_region", "scale_region", "move_region", "remove_region", "generative_inpaint"]);

// Which ablatable element an op touches. Cue-only elements (typography...) are never editable.
function opElements(op: EditOpValue, region: PlanRegion | undefined): string[] {
  const out: string[] = [];
  if (op.op === "recolor_region" || op.op === "change_background" || op.op === "add_band" || op.op === "tone") {
    out.push("color");
  }
  if (op.op === "scale_region" || op.op === "move_region") out.push("layout");
  if (region && ["mascot_character", "product", "other_text"].includes(region.kind)) out.push(region.kind);
  return out;
}

function hexesOf(op: EditOpValue): string[] {
  if (op.op === "recolor_region" || op.op === "change_background") return [op.targetHex];
  if (op.op === "add_band") return [op.hex];
  return [];
}

export function footprintAfter(op: EditOpValue, box: NormBox): NormBox | null {
  const [ymin, xmin, ymax, xmax] = box;
  if (op.op === "move_region") {
    const dy = op.dyPct * 10;
    const dx = op.dxPct * 10;
    return norm(ymin + dy, xmin + dx, ymax + dy, xmax + dx);
  }
  if (op.op === "scale_region") {
    const h = (ymax - ymin) * op.factor;
    const w = (xmax - xmin) * op.factor;
    const cy = (ymin + ymax) / 2;
    const cx = (xmin + xmax) / 2;
    if (op.anchor === "center") return norm(cy - h / 2, cx - w / 2, cy + h / 2, cx + w / 2);
    if (op.anchor === "top") return norm(ymin, cx - w / 2, ymin + h, cx + w / 2);
    if (op.anchor === "bottom") return norm(ymax - h, cx - w / 2, ymax, cx + w / 2);
    if (op.anchor === "left") return norm(cy - h / 2, xmin, cy + h / 2, xmin + w);
    return norm(cy - h / 2, xmax - w, cy + h / 2, xmax);
  }
  return null;
}

export function bandBox(op: Extract<EditOpValue, { op: "add_band" }>): NormBox {
  const t = op.thicknessPct * 10;
  if (op.edge === "top") return norm(0, 0, t, 1000);
  if (op.edge === "bottom") return norm(1000 - t, 0, 1000, 1000);
  if (op.edge === "left") return norm(0, 0, 1000, t);
  return norm(0, 1000 - t, 1000, 1000);
}

// Pure static validation. Strings are used verbatim in the repair request, so keep them precise.
export function validatePlan(plan: EditPlanValue, ctx: PlanContext): string[] {
  const violations: string[] = [];
  const { brief } = ctx;
  const byRef = new Map(ctx.regions.map((r) => [r.ref, r]));
  const locked = ctx.regions.filter((r) => r.locked || r.isIdentifier);
  const lockedEls = new Set<string>(brief.lockedElements);

  if (lockedEls.has(plan.primaryElement)) {
    violations.push(`primaryElement "${plan.primaryElement}" is locked in the brief`);
  }

  plan.ops.forEach((op, i) => {
    const at = `op ${i + 1} (${op.op})`;
    if (op.op === "generative_inpaint") {
      if (ctx.generativeEnabled !== true) violations.push(`${at}: generative edits are not enabled; use only the listed operations`);
      if (/\b(logo|brand name|wordmark)\b/i.test(op.instruction)) violations.push(`${at}: the instruction must not ask for a logo or brand name`);
    }
    let region: PlanRegion | undefined;
    if ("regionId" in op) {
      region = byRef.get(op.regionId);
      if (!region) violations.push(`${at}: region ${op.regionId} does not exist`);
    }
    if (region && REGION_OPS.has(op.op) && (region.locked || region.isIdentifier)) {
      violations.push(`${at}: region ${region.ref} is locked or a brand identifier and cannot be edited`);
    }
    for (const el of opElements(op, region)) {
      if (lockedEls.has(el)) violations.push(`${at}: edits locked element "${el}"`);
    }
    if (brief.colorFreedom === "locked") {
      if (["recolor_region", "change_background", "add_band"].includes(op.op)) {
        violations.push(`${at}: colour is locked in the brief`);
      }
      if (op.op === "tone" && op.saturation !== 1) violations.push(`${at}: colour is locked, saturation must be 1`);
    }
    for (const hex of hexesOf(op)) {
      if (brief.colorFreedom === "palette_only" && !brief.palette.some((p) => hexDeltaE(hex, p) < 8)) {
        violations.push(`${at}: ${hex} is not within DeltaE 8 of the brand palette`);
      }
      const clash = ctx.escapeColors.find((c) => hexDeltaE(hex, c) < 12);
      if (clash) violations.push(`${at}: ${hex} is too close to ${clash}, a colour linked to the competitor to escape`);
    }
    if (op.op === "add_band") {
      const band = bandBox(op);
      const hit = locked.find((l) => intersection(band, l.box) > 0);
      if (hit) violations.push(`${at}: band would cover locked region ${hit.ref}`);
    }
    if (region && (op.op === "scale_region" || op.op === "move_region")) {
      const after = footprintAfter(op, region.box);
      if (after) {
        const [a, b, c, d] = after;
        if (a < 0 || b < 0 || c > 1000 || d > 1000) violations.push(`${at}: region ${region.ref} would leave the canvas`);
        const hit = locked.find((l) => l.ref !== region.ref && area(after) > 0 && intersection(after, l.box) > 0);
        if (hit) violations.push(`${at}: region ${region.ref} would overlap locked region ${hit.ref}`);
      }
    }
  });
  return violations;
}

export function planSignature(plan: EditPlanValue): string {
  return JSON.stringify(plan.ops.map((o) => [o.op, "regionId" in o ? o.regionId : ""]));
}
