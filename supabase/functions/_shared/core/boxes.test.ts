import { describe, expect, it } from "vitest";
import { boxArea, clampBox } from "./boxes.ts";

describe("clampBox", () => {
  it("clamps to 0..1000 and rounds", () => {
    expect(clampBox([-5, 10.4, 1200, 999.6])).toEqual([0, 10, 1000, 1000]);
  });
  it("reorders swapped corners", () => {
    expect(clampBox([500, 600, 100, 200])).toEqual([100, 200, 500, 600]);
  });
});

describe("boxArea", () => {
  it("computes area in normalized units", () => {
    expect(boxArea([0, 0, 100, 200])).toBe(20000);
  });
});
