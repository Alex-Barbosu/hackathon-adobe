import { describe, expect, it } from "vitest";
import { checkNumbers, direction, numberTokens, pct, pctRange, points, templateReport, type ReportData } from "./reportdata.ts";

const data: ReportData = {
  notice: "Simulated AI panel, not real people.",
  target: { brand: "Sunny", attribution: "31%", interval: "22–40%", votes: 12, batches: 2 },
  control: { attribution: "4%" },
  elements: [
    { element: "mascot_character", label: "strong_asset", change: "35 points", direction: "higher", interval: "20–50%" },
    { element: "color", label: "traitor", change: "12 points", direction: "higher", interval: "5–19%" },
  ],
  findings: [],
  similarity: { percentile: "82%", nearestBrand: "Zest" },
  quiz: null,
  variants: [
    { name: "V1", title: "Bigger bird", hypothesis: "h", status: "tested", changedPixels: "12%", attributionChange: "14 points", attributionDirection: "higher", interval: "3–25%", similarityChange: null, brandFit: "passes", wins: true },
  ],
  caveats: ["The panel is simulated, not real people."],
};

describe("formatting", () => {
  it("formats percentages, ranges and point changes", () => {
    expect(pct(0.314)).toBe("31%");
    expect(pctRange([0.224, 0.401])).toBe("22–40%");
    expect(points(-0.351)).toBe("35 points");
    expect(direction(0.2)).toBe("higher");
    expect(direction(-0.2)).toBe("lower");
    expect(direction(0.001)).toBe("unchanged");
  });
});

describe("number check", () => {
  it("accepts numbers that appear in the data, including ranges and percentages", () => {
    const md = "Sunny was picked by 31% (22–40%). 2 calls, 12 viewers. Mascot: 35 points. Similarity 82%.";
    expect(checkNumbers(md, data).offending).toEqual([]);
  });
  it("flags invented or recomputed numbers", () => {
    const check = checkNumbers("About 33% picked Sunny, a 4.5 point swing of 99.", data);
    expect(check.offending).toEqual(["33", "4.5", "99"]);
    expect(check.checked).toBe(3);
  });
  it("ignores list ordinals", () => {
    expect(checkNumbers("1. First\n2) Second", data).offending).toEqual([]);
  });
  it("tokenises decimals with commas", () => {
    expect(numberTokens("1,5 and 22–40%")).toEqual(["1.5", "22", "40"]);
  });
});

describe("template report", () => {
  it("is built only from the data and passes its own number check", () => {
    const md = templateReport(data);
    expect(md).toContain("Sunny");
    expect(md).toContain("31%");
    expect(checkNumbers(md, data).offending).toEqual([]);
  });
});
