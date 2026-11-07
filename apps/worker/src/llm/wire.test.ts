import { z } from "zod";
import { describe, expect, it } from "vitest";
import { PlanBatch, ELEMENTS } from "@nologo/core";
import type { Task } from "./client.ts";
import { toWireSchema } from "./gemini.ts";
import { BrandFitOutput } from "./prompts/brand_fit.ts";
import { DetectOutput } from "./prompts/detect.ts";
import { DirectionsOutput } from "./prompts/directions.ts";
import { LeakOutput } from "./prompts/leak_check.ts";
import { PanelOutput } from "./prompts/panel.ts";
import { DynamicQuestionsOutput } from "./prompts/quiz_bank.ts";
import { ReportOutput } from "./prompts/report.ts";
import { schemaToJson } from "./service.ts";

// Typed as Record<Task, ...> so adding a task without a schema here fails the typecheck.
const SCHEMAS: Record<Task, z.ZodType> = {
  detect: DetectOutput,
  leak_check: LeakOutput,
  panel: PanelOutput,
  quiz_bank: DynamicQuestionsOutput,
  directions: DirectionsOutput,
  plan: PlanBatch,
  plan_repair: PlanBatch,
  brand_fit: BrandFitOutput,
  report: ReportOutput,
};

const STRIPPED = [
  "$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength",
  "pattern", "format", "minItems", "maxItems", "minProperties", "maxProperties", "uniqueItems",
];
const UNIONS = ["anyOf", "oneOf", "allOf"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Finds forbidden keywords anywhere in the schema, skipping field NAMES under "properties".
function forbidden(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => forbidden(v, `${path}[${i}]`));
  if (!isObj(node)) return [];
  return Object.entries(node).flatMap(([k, v]) => {
    const here = [...STRIPPED, ...UNIONS].includes(k) ? [`${path}.${k}`] : [];
    if (k === "properties" && isObj(v)) return [...here, ...Object.entries(v).flatMap(([n, sub]) => forbidden(sub, `${path}.properties.${n}`))];
    return [...here, ...forbidden(v, `${path}.${k}`)];
  });
}

describe("toWireSchema", () => {
  it.each(Object.entries(SCHEMAS))("%s: no bounds, lengths, patterns, formats, item counts or unions are sent", (_task, schema) => {
    const full = schemaToJson(schema);
    const wire = toWireSchema(full);
    expect(forbidden(wire)).toEqual([]);
    expect(wire["type"]).toBe("object");
  });

  it("the full schemas really do contain constraints, so the test is not vacuous", () => {
    const all = Object.values(SCHEMAS).flatMap((s) => forbidden(schemaToJson(s)));
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((p) => p.endsWith(".oneOf") || p.endsWith(".anyOf"))).toBe(true);
    expect(all.some((p) => p.endsWith(".maxItems"))).toBe(true);
    expect(all.some((p) => p.endsWith(".pattern"))).toBe(true);
  });

  it("flattens EditOp into one object with an op enum and optional fields", () => {
    const wire = toWireSchema(schemaToJson(PlanBatch)) as {
      properties: { plans: { items: { properties: { ops: { items: { type: string; properties: Record<string, { enum?: string[]; type?: string }>; required: string[] } } } } } };
    };
    const op = wire.properties.plans.items.properties.ops.items;
    expect(op.type).toBe("object");
    expect(op.properties["op"]?.enum).toEqual([
      "recolor_region", "change_background", "scale_region", "move_region", "remove_region", "add_band", "tone", "generative_inpaint",
    ]);
    // Only the discriminator is required; every operation field is optional on the wire.
    expect(op.required).toEqual(["op"]);
    // Optional on the wire, but the description tells the model what each operation needs.
    const desc = (op.properties["op"] as { description?: string }).description ?? "";
    expect(desc).toContain("tone: saturation, contrast");
    expect(desc).toContain("add_band: edge, thicknessPct, hex");
    expect((op.properties["contrast"] as { description?: string }).description).toContain("used by: tone");
    for (const field of ["regionId", "targetHex", "toleranceDE", "factor", "anchor", "dxPct", "edge", "thicknessPct", "hex", "saturation", "contrast", "instruction"]) {
      expect(op.properties[field], field).toBeDefined();
    }
  });

  it("strips formats and patterns from uuid and string schemas", () => {
    const wire = toWireSchema(schemaToJson(z.object({ id: z.uuid(), when: z.iso.datetime() })));
    expect(forbidden(wire)).toEqual([]);
    expect(forbidden(schemaToJson(z.object({ id: z.uuid() }))).length).toBeGreaterThan(0);
  });

  it("keeps property names that look like keywords", () => {
    const schema = z.object({ format: z.string(), minimum: z.number().min(1).max(5), pattern: z.string().regex(/^a/) });
    const wire = toWireSchema(schemaToJson(schema)) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(wire.properties)).toEqual(["format", "minimum", "pattern"]);
    expect(wire.required).toEqual(["format", "minimum", "pattern"]);
    expect(forbidden(wire)).toEqual([]);
  });

  it("collapses nullable fields to a type array and rejects unions it cannot flatten", () => {
    const wire = toWireSchema(schemaToJson(z.object({ n: z.string().nullable() }))) as { properties: { n: { type: unknown } } };
    expect(wire.properties.n.type).toEqual(["string", "null"]);
    expect(() => toWireSchema(schemaToJson(z.object({ u: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]) })))).toThrow(/unsupported union/);
  });
});

describe("the strict zod schema still validates what comes back", () => {
  const valid = { title: "t", hypothesis: "h", primaryElement: "color", directionTags: [], ops: [{ op: "tone", saturation: 1, contrast: 1 }] };

  it("accepts a correct plan batch", () => {
    expect(PlanBatch.safeParse({ plans: [valid, valid, valid] }).success).toBe(true);
  });

  it("rejects what the loose wire schema would let through", () => {
    // Wrong plan count (item-count limit), out-of-range number (numeric bound), missing op field (flattened union).
    expect(PlanBatch.safeParse({ plans: [valid] }).success).toBe(false);
    expect(PlanBatch.safeParse({ plans: [valid, valid, { ...valid, ops: [{ op: "scale_region", regionId: "R1", factor: 9, anchor: "center" }] }] }).success).toBe(false);
    expect(PlanBatch.safeParse({ plans: [valid, valid, { ...valid, ops: [{ op: "scale_region", regionId: "R1" }] }] }).success).toBe(false);
    expect(DetectOutput.safeParse({ regions: [{ kind: "logo", label: "x", box_2d: [1, 2, 3], confidence: 0.5 }] }).success).toBe(false);
    expect(ELEMENTS.length).toBe(5);
  });
});
