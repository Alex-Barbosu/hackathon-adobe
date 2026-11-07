import { describe, expect, it } from "vitest";
import {
  area, clampNorm, iou, norm, pad, postProcessDetections, px, toNorm, toPixels, union, wasInverted,
} from "./boxes.ts";

describe("clampNorm", () => {
  it("clamps to 0..1000 and rounds", () => {
    expect(clampNorm([-5, 10.4, 1200, 999.6])).toEqual([0, 10, 1000, 1000]);
  });
  it("swaps inverted corners and reports them", () => {
    expect(clampNorm([500, 600, 100, 200])).toEqual([100, 200, 500, 600]);
    expect(wasInverted([500, 600, 100, 200])).toBe(true);
    expect(wasInverted([1, 2, 3, 4])).toBe(false);
  });
});

describe("geometry", () => {
  it("handles zero-area boxes", () => {
    expect(area(norm(10, 10, 10, 50))).toBe(0);
    expect(iou(norm(10, 10, 10, 50), norm(10, 10, 10, 50))).toBe(0);
  });
  it("computes iou and union", () => {
    const a = norm(0, 0, 100, 100);
    const b = norm(0, 50, 100, 150);
    expect(iou(a, b)).toBeCloseTo(1 / 3, 5);
    expect(union(a, b)).toEqual([0, 0, 100, 150]);
  });
  it("round-trips pixels with floor/ceil so coverage never shrinks", () => {
    const p = toPixels(norm(1, 1, 999, 999), 100, 100);
    expect(p).toEqual([0, 0, 100, 100]);
    const back = toNorm(px(10, 20, 50, 60), 100, 100);
    expect(back).toEqual([100, 200, 500, 600]);
  });
  it("pads by ratio with a minimum and clips to the canvas", () => {
    expect(pad(px(10, 10, 30, 30), 0.08, 6, 100, 100)).toEqual([4, 4, 36, 36]);
    expect(pad(px(0, 0, 100, 100), 0.08, 6, 100, 100)).toEqual([0, 0, 100, 100]);
  });
});

describe("postProcessDetections", () => {
  it("drops slivers, merges same-kind overlaps, keeps different kinds", () => {
    const out = postProcessDetections([
      { kind: "logo", label: "a", box: norm(0, 0, 100, 100), confidence: 0.9 },
      { kind: "logo", label: "b", box: norm(5, 5, 105, 105), confidence: 0.8 },
      { kind: "product", label: "c", box: norm(0, 0, 100, 100), confidence: 0.7 },
      { kind: "logo", label: "tiny", box: norm(0, 0, 1, 1), confidence: 0.9 },
    ]);
    expect(out.map((r) => r.kind)).toEqual(["logo", "product"]);
    expect(out[0]?.box).toEqual([0, 0, 105, 105]);
  });
});
