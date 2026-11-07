import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./config.ts";
import { diagnose, type DiagnosisInput, type ImpactInput } from "./diagnosis.ts";
import type { ConditionSummary } from "./stats.ts";

const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };

const baseline = (over: Partial<ConditionSummary> = {}): ConditionSummary => ({
  nVotes: 12,
  nBatches: 2,
  attribution: 0.6,
  attributionCi: [0.5, 0.7],
  pull: { comp1: 0.2, none: 0.2 },
  pullCi: { comp1: [0.1, 0.3], none: [0.1, 0.3] },
  cueFreq: { mascot_character: 0.6, color: 0.5 },
  sawIdentifierShare: 0,
  ...over,
});

const impact = (over: Partial<ImpactInput>): ImpactInput => ({
  element: "mascot_character",
  delta: 0,
  deltaCi: [-0.02, 0.02],
  pullShift: { comp1: 0, none: 0 },
  pullShiftCi: { comp1: [-0.02, 0.02], none: [-0.02, 0.02] },
  ...over,
});

const input = (over: Partial<DiagnosisInput> = {}): DiagnosisInput => ({
  thresholds,
  baseline: baseline(),
  controlAttribution: 0.1,
  impacts: [],
  centroidPercentile: 0.3,
  leakShare: 0,
  ...over,
});

const keys = (i: DiagnosisInput): string[] => diagnose(i).findings.map((f) => f.findingKey);

describe("diagnosis rules", () => {
  it("strong_asset needs lower CI above threshold and enough cue share", () => {
    const strong = impact({ delta: 0.5, deltaCi: [0.3, 0.7] });
    expect(keys(input({ impacts: [strong] }))).toContain("strong_asset:mascot_character");
    expect(keys(input({ impacts: [impact({ delta: 0.5, deltaCi: [0.05, 0.9] })] }))).not.toContain("strong_asset:mascot_character");
    expect(keys(input({ impacts: [strong], baseline: baseline({ cueFreq: { mascot_character: 0.1 } }) }))).not.toContain(
      "strong_asset:mascot_character",
    );
  });
  it.each([
    [0.12, 3],
    [0.22, 4],
    [0.35, 5],
  ])("strong_asset severity for delta %s is %s", (delta, severity) => {
    const f = diagnose(input({ impacts: [impact({ delta, deltaCi: [0.15, 0.6] })] })).findings.find((x) => x.rule === "strong_asset");
    expect(f?.severity).toBe(severity);
  });
  it("decoration when |delta| small and CI contains 0", () => {
    expect(keys(input({ impacts: [impact({})] }))).toContain("decoration:mascot_character");
    expect(keys(input({ impacts: [impact({ delta: 0.02, deltaCi: [0.01, 0.03] })] }))).not.toContain("decoration:mascot_character");
    expect(keys(input({ impacts: [impact({ delta: 0.05, deltaCi: [-0.1, 0.2] })] }))).not.toContain("decoration:mascot_character");
  });
  it("traitor only for the single strongest competitor with CI above 0", () => {
    const t = impact({
      element: "color",
      delta: 0.05,
      deltaCi: [-0.1, 0.2],
      pullShift: { comp1: 0.25, comp2: 0.05, none: 0 },
      pullShiftCi: { comp1: [0.1, 0.4], comp2: [0, 0.1], none: [0, 0] },
    });
    const r = diagnose(input({ impacts: [t] }));
    const f = r.findings.find((x) => x.rule === "traitor");
    expect(f?.findingKey).toBe("traitor:color:comp1");
    expect(f?.severity).toBe(4);
    expect(r.labels["color"]).toBe("traitor");
    const noisy = impact({ element: "color", pullShift: { comp1: 0.25, none: 0 }, pullShiftCi: { comp1: [-0.1, 0.5], none: [0, 0] } });
    expect(keys(input({ impacts: [noisy] }))).not.toContain("traitor:color:comp1");
  });
  it("generic by percentile with graded severity", () => {
    expect(keys(input({ centroidPercentile: 0.5 }))).not.toContain("generic");
    expect(diagnose(input({ centroidPercentile: 0.8 })).findings.find((f) => f.rule === "generic")?.severity).toBe(3);
    expect(diagnose(input({ centroidPercentile: 0.9 })).findings.find((f) => f.rule === "generic")?.severity).toBe(4);
    expect(diagnose(input({ centroidPercentile: 0.99 })).findings.find((f) => f.rule === "generic")?.severity).toBe(5);
    expect(keys(input({ centroidPercentile: null }))).not.toContain("generic");
  });
  it("known_brand, leak and misattribution", () => {
    expect(keys(input({ controlAttribution: 0.6 }))).toContain("known_brand");
    expect(keys(input({ controlAttribution: null }))).not.toContain("known_brand");
    expect(keys(input({ leakShare: 0.2 }))).toContain("leak");
    const mis = keys(input({ baseline: baseline({ attribution: 0.2, pull: { comp1: 0.5, none: 0.3 } }) }));
    expect(mis).toContain("misattribution:comp1");
    expect(mis).not.toContain("misattribution:none");
  });
  it("labels: traitor beats strong_asset beats decoration beats neutral; findings sorted by severity", () => {
    const r = diagnose(
      input({
        impacts: [
          impact({ element: "mascot_character", delta: 0.4, deltaCi: [0.3, 0.5] }),
          impact({ element: "product", delta: 0.06, deltaCi: [0.01, 0.1] }),
          impact({ element: "layout" }),
        ],
        leakShare: 0.5,
      }),
    );
    expect(r.labels).toEqual({ mascot_character: "strong_asset", product: "neutral", layout: "decoration" });
    expect(r.findings[0]?.rule).toBe("leak");
    const sev = r.findings.map((f) => f.severity);
    expect([...sev].sort((a, b) => b - a)).toEqual(sev);
  });
});
