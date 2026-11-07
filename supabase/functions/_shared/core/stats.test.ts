import { describe, expect, it } from "vitest";
import {
  conditionStats, diffStat, elementImpactNumbers, mean, normalizeScores, parsePanelPeople, percentile, summarize,
  wideCi, type Vote,
} from "./stats.ts";

const T = "target";
const C1 = "comp1";

const vote = (batchId: string, pt: number, pc: number, cues: string[] = []): Vote => ({
  batchId,
  probabilities: { [T]: pt, [C1]: pc, none: Math.max(0, 1 - pt - pc) },
  cues: cues.map((element) => ({ element, text: "x" })),
  sawIdentifier: false,
});

const votes = (pt: number, pc: number, cues: string[] = []): Vote[] =>
  Array.from({ length: 12 }, (_, i) => vote(i < 6 ? "b1" : "b2", pt, pc, cues));

describe("normalizeScores", () => {
  it("clamps negatives, divides by sum, keeps raw", () => {
    const n = normalizeScores({ A: -1, B: 3, C: 1 });
    expect(n.probabilities).toEqual({ A: 0, B: 0.75, C: 0.25 });
    expect(n.raw["A"]).toBe(-1);
  });
  it("uses uniform when everything is zero", () => {
    expect(normalizeScores({ A: 0, B: 0 }).probabilities).toEqual({ A: 0.5, B: 0.5 });
  });
  it("normalises sums of 3", () => {
    const p = normalizeScores({ A: 1.5, B: 1, C: 0.5 }).probabilities;
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe("parsePanelPeople", () => {
  const labels = { P1: "heavy_weekly", P2: "light_occasional" };
  const letters = { A: "brand-a", B: "brand-b", C: "none" };
  const person = (p: string, scores: Array<[string, number]>) => ({
    person: p,
    scores: scores.map(([candidate, probability]) => ({ candidate, probability })),
    cues: [],
    saw_identifier: false,
  });
  it("maps letters, fills missing candidates with 0 and reports missing people", () => {
    const r = parsePanelPeople([person("P1", [["A", 0.6], ["C", 0.4]])], labels, letters);
    expect(r.votes[0]?.probabilities).toEqual({ "brand-a": 0.6, "brand-b": 0, none: 0.4 });
    expect(r.missing).toEqual(["light_occasional"]);
  });
  it("drops people with unknown or duplicate letters, unexpected labels and duplicates", () => {
    const r = parsePanelPeople(
      [
        person("P1", [["Z", 1], ["A", 0]]),
        person("P2", [["A", 0.5], ["A", 0.5]]),
        person("P9", [["A", 1], ["B", 0]]),
      ],
      labels,
      letters,
    );
    expect(r.votes).toHaveLength(0);
    expect(r.dropped.map((d) => d.person)).toEqual(["P1", "P2", "P9"]);
    const dup = parsePanelPeople([person("P1", [["A", 1], ["B", 0]]), person("P1", [["A", 1], ["B", 0]])], labels, letters);
    expect(dup.votes).toHaveLength(1);
    expect(dup.dropped[0]?.reason).toBe("duplicate person");
  });
  it("accepts lowercase letters", () => {
    const r = parsePanelPeople([person("P1", [["a", 1], ["b", 0]])], labels, letters);
    expect(r.votes).toHaveLength(1);
  });
});

describe("conditionStats", () => {
  it("computes means, cue frequencies and deterministic intervals", () => {
    const vs = votes(0.8, 0.1, ["mascot_character"]);
    const a = conditionStats(vs, [T, C1, "none"], 123, 300);
    const b = conditionStats(vs, [T, C1, "none"], 123, 300);
    expect(a.means[T]).toBeCloseTo(0.8, 10);
    expect(a.cueFreq["mascot_character"]).toBe(1);
    expect(a.nBatches).toBe(2);
    expect(JSON.stringify(summarize(a, T))).toBe(JSON.stringify(summarize(b, T)));
    const s = summarize(a, T);
    expect(s.attributionCi[0]).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(s.attributionCi[1]).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(s.pull[C1]).toBeCloseTo(0.1, 10);
  });
  it("widens the interval when votes vary", () => {
    const mixed = [...votes(0.9, 0, []).slice(0, 6), ...votes(0.1, 0, []).slice(0, 6)];
    const s = summarize(conditionStats(mixed, [T], 5, 400), T);
    expect(s.attributionCi[1] - s.attributionCi[0]).toBeGreaterThan(0.2);
  });
  it("handles empty input", () => {
    const s = conditionStats([], [T], 1, 10);
    expect(s.nVotes).toBe(0);
    expect(s.means[T]).toBe(0);
  });
  it("takes the wider of cluster and vote intervals", () => {
    const [lo, hi] = wideCi({ cluster: [0.5, 0.5], vote: [0.2, 0.8] });
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
  });
});

describe("element impacts", () => {
  it("recovers a known delta of 0.5 with a CI above zero", () => {
    const base = conditionStats(votes(0.8, 0.1), [T, C1, "none"], 1, 400);
    const abl = conditionStats(votes(0.3, 0.5), [T, C1, "none"], 2, 400);
    const impact = elementImpactNumbers(base, abl, T, [C1]);
    expect(impact.delta).toBeCloseTo(0.5, 10);
    expect(impact.deltaCi[0]).toBeGreaterThan(0.4);
    expect(impact.pullShift[C1]).toBeCloseTo(-0.4, 10);
    expect(diffStat(base, abl, T).mean).toBeCloseTo(0.5, 10);
  });
  it("throws on an unknown key", () => {
    const s = conditionStats(votes(0.5, 0.2), [T], 1, 10);
    expect(() => diffStat(s, s, "ghost")).toThrow();
  });
});

describe("helpers", () => {
  it("percentile and mean", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNaN();
    expect(mean([])).toBe(0);
    expect(mean([1, 3])).toBe(2);
  });
});
