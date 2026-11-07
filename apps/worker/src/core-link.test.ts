import { describe, expect, it } from "vitest";
import { clampNorm } from "@nologo/core";

// Proves the worker consumes the same pure core that the Deno Edge Function imports.
describe("shared core from worker", () => {
  it("resolves @nologo/core", () => {
    expect(clampNorm([-1, 0, 2000, 5])).toEqual([0, 0, 1000, 5]);
  });
});
