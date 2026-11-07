import { describe, expect, it } from "vitest";
import { ALLOWED_FROM, canTransition, type AnalysisStatus } from "./state.ts";

describe("analysis state machine", () => {
  it("follows the happy path in order", () => {
    const path: AnalysisStatus[] = [
      "created", "ingesting", "detecting", "needs_review", "masking", "testing", "aggregating", "diagnosed",
      "quiz_ready", "quiz_in_progress", "planning", "rendering", "retesting", "reporting", "done",
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });
  it("allows the leak-check loop back to review and the shortcut from created to detecting", () => {
    expect(canTransition("masking", "needs_review")).toBe(true);
    expect(canTransition("created", "detecting")).toBe(true);
  });
  it("rejects skipping and going backwards", () => {
    expect(canTransition("created", "testing")).toBe(false);
    expect(canTransition("testing", "masking")).toBe(false);
    expect(canTransition("done", "reporting")).toBe(false);
    expect(canTransition("quiz_ready", "planning")).toBe(false);
  });
  it("lets any live status fail, but not a finished one", () => {
    for (const s of Object.keys(ALLOWED_FROM) as AnalysisStatus[]) {
      expect(canTransition(s, "failed")).toBe(s !== "done");
    }
    expect(canTransition("failed", "failed")).toBe(false);
  });
});
