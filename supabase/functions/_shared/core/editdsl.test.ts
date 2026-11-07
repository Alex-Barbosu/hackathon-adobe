import { describe, expect, it } from "vitest";
import { norm } from "./boxes.ts";
import { EditPlan, PlanBatch, bandBox, editDslSpec, footprintAfter, planSignature, validatePlan, type EditPlanValue, type PlanContext } from "./editdsl.ts";
import { compileBrief, emptyDraft } from "./quiz/brief.ts";

const brief = (over: Record<string, unknown> = {}) => {
  const { brief: b } = compileBrief(
    { ...emptyDraft(), fields: { colorFreedom: "open", ...over } },
    { identifierRegionIds: [], directionPreferences: [], topDirectionIds: [] },
  );
  return b;
};

const ctx = (over: Partial<PlanContext> = {}, briefOver: Record<string, unknown> = {}): PlanContext => ({
  regions: [
    { ref: "R1", kind: "logo", box: norm(0, 0, 100, 200), locked: true, isIdentifier: true },
    { ref: "R2", kind: "mascot_character", box: norm(400, 100, 600, 300), locked: false, isIdentifier: false },
    { ref: "R3", kind: "product", box: norm(400, 600, 600, 900), locked: true, isIdentifier: false },
  ],
  brief: brief(briefOver),
  escapeColors: [],
  ...over,
});

const plan = (ops: EditPlanValue["ops"], primaryElement: EditPlanValue["primaryElement"] = "mascot_character"): EditPlanValue => ({
  title: "t",
  hypothesis: "h",
  primaryElement,
  directionTags: [],
  ops,
});

describe("EditPlan schema", () => {
  it("accepts a valid plan and rejects out-of-range values", () => {
    expect(EditPlan.safeParse(plan([{ op: "remove_region", regionId: "R2" }])).success).toBe(true);
    expect(EditPlan.safeParse(plan([{ op: "scale_region", regionId: "R2", factor: 9, anchor: "center" }])).success).toBe(false);
    expect(EditPlan.safeParse(plan([])).success).toBe(false);
    expect(PlanBatch.safeParse({ plans: [] }).success).toBe(false);
  });
  it("generates its spec from the schema", () => {
    expect(editDslSpec()).toContain("recolor_region");
    expect(editDslSpec()).toContain("toleranceDE");
  });
});

describe("validatePlan", () => {
  it("passes a clean plan", () => {
    expect(validatePlan(plan([{ op: "scale_region", regionId: "R2", factor: 1.2, anchor: "center" }]), ctx())).toEqual([]);
  });
  it("flags unknown regions, identifiers and locked regions", () => {
    const v = validatePlan(
      plan([
        { op: "remove_region", regionId: "R9" },
        { op: "remove_region", regionId: "R1" },
        { op: "recolor_region", regionId: "R3", targetHex: "#ff0000", toleranceDE: 10 },
      ]),
      ctx(),
    );
    expect(v.some((x) => x.includes("R9 does not exist"))).toBe(true);
    expect(v.some((x) => x.includes("R1 is locked or a brand identifier"))).toBe(true);
    expect(v.some((x) => x.includes("R3 is locked"))).toBe(true);
  });
  it("enforces locked colour freedom", () => {
    const c = ctx({}, { colorFreedom: "locked" });
    const v = validatePlan(
      plan([
        { op: "change_background", targetHex: "#00ff00", toleranceDE: 10 },
        { op: "add_band", edge: "top", thicknessPct: 5, hex: "#00ff00" },
        { op: "tone", saturation: 1.2, contrast: 1 },
      ], "color"),
      c,
    );
    expect(v.filter((x) => x.includes("colour is locked"))).toHaveLength(3);
    expect(validatePlan(plan([{ op: "tone", saturation: 1, contrast: 1.1 }], "layout"), c)).toEqual([]);
  });
  it("enforces palette-only within DeltaE 8", () => {
    const c = ctx({}, { colorFreedom: "palette_only", palette: ["#ffcc00"] });
    expect(validatePlan(plan([{ op: "change_background", targetHex: "#ffcd01", toleranceDE: 10 }], "color"), c)).toEqual([]);
    expect(validatePlan(plan([{ op: "change_background", targetHex: "#0000ff", toleranceDE: 10 }], "color"), c)[0]).toContain(
      "not within DeltaE 8",
    );
  });
  it("blocks locked elements and escape colours", () => {
    const c = ctx({ escapeColors: ["#ff0000"] }, { lockedElements: ["mascot_character"] });
    const v = validatePlan(plan([{ op: "scale_region", regionId: "R2", factor: 1.1, anchor: "center" }]), c);
    expect(v.some((x) => x.includes('primaryElement "mascot_character" is locked'))).toBe(true);
    expect(v.some((x) => x.includes('edits locked element "mascot_character"'))).toBe(true);
    const e = validatePlan(plan([{ op: "change_background", targetHex: "#fe0101", toleranceDE: 10 }], "color"), c);
    expect(e.some((x) => x.includes("competitor to escape"))).toBe(true);
  });
  it("checks footprints and bands against canvas and locked regions", () => {
    const off = validatePlan(plan([{ op: "move_region", regionId: "R2", dxPct: -40, dyPct: 0 }], "layout"), ctx());
    expect(off.some((x) => x.includes("leave the canvas"))).toBe(true);
    const hit = validatePlan(plan([{ op: "move_region", regionId: "R2", dxPct: 40, dyPct: 0 }], "layout"), ctx());
    expect(hit.some((x) => x.includes("overlap locked region R3"))).toBe(true);
    const band = validatePlan(plan([{ op: "add_band", edge: "top", thicknessPct: 15, hex: "#00ff00" }], "color"), ctx());
    expect(band.some((x) => x.includes("cover locked region R1"))).toBe(true);
  });
});

describe("footprint math and signatures", () => {
  it("scales around each anchor", () => {
    const b = norm(400, 400, 600, 600);
    expect(footprintAfter({ op: "scale_region", regionId: "R", factor: 2, anchor: "center" }, b)).toEqual([300, 300, 700, 700]);
    expect(footprintAfter({ op: "scale_region", regionId: "R", factor: 2, anchor: "top" }, b)).toEqual([400, 300, 800, 700]);
    expect(footprintAfter({ op: "scale_region", regionId: "R", factor: 2, anchor: "bottom" }, b)).toEqual([200, 300, 600, 700]);
    expect(footprintAfter({ op: "scale_region", regionId: "R", factor: 2, anchor: "left" }, b)).toEqual([300, 400, 700, 800]);
    expect(footprintAfter({ op: "scale_region", regionId: "R", factor: 2, anchor: "right" }, b)).toEqual([300, 200, 700, 600]);
    expect(footprintAfter({ op: "remove_region", regionId: "R" }, b)).toBeNull();
  });
  it("computes band boxes and plan signatures", () => {
    expect(bandBox({ op: "add_band", edge: "left", thicknessPct: 5, hex: "#000000" })).toEqual([0, 0, 1000, 50]);
    expect(bandBox({ op: "add_band", edge: "right", thicknessPct: 5, hex: "#000000" })).toEqual([0, 950, 1000, 1000]);
    expect(bandBox({ op: "add_band", edge: "bottom", thicknessPct: 10, hex: "#000000" })).toEqual([900, 0, 1000, 1000]);
    const a = plan([{ op: "remove_region", regionId: "R2" }]);
    expect(planSignature(a)).toBe(planSignature(plan([{ op: "remove_region", regionId: "R2" }])));
  });
});
