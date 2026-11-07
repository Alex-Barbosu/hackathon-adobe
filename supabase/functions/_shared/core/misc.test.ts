import { describe, expect, it } from "vitest";
import { deltaE2000, hexDeltaE, hexToRgb, kmeansPalette, labToRgb, rgbToHex, rgbToLab } from "./color.ts";
import { MASK_HEX, MASK_RGB, isIdentifierKind, resolveConfig } from "./config.ts";
import { ELO_START, expectedScore, updateNeither, updatePair } from "./elo.ts";
import { JobMessage, queueFor } from "./schemas/jobs.ts";
import { EventPayloads } from "./schemas/events.ts";
import { centroid, cosine, l2Normalize, similarityFor, similarityOfVariant } from "./similarity.ts";

describe("color", () => {
  it("round-trips sRGB through Lab", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [140, 143, 147], [200, 30, 60]] as const) {
      const back = labToRgb(rgbToLab(rgb));
      back.forEach((c, i) => expect(Math.abs(c - rgb[i]!)).toBeLessThanOrEqual(1));
    }
  });
  it("matches published CIEDE2000 reference pairs", () => {
    // Sharma, Wu, Dalal (2005) test data, pairs 1 and 2.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(2.8615, 3);
    expect(hexDeltaE("#ff0000", "#ff0000")).toBeCloseTo(0, 6);
    expect(hexDeltaE("#ff0000", "#00ff00")).toBeGreaterThan(50);
  });
  it("parses hex and rejects garbage", () => {
    expect(hexToRgb("#8C8F93")).toEqual(MASK_RGB);
    expect(rgbToHex([140, 143, 147])).toBe(MASK_HEX.toLowerCase());
    expect(() => hexToRgb("nope")).toThrow();
  });
  it("k-means finds the dominant colours deterministically", () => {
    const data = new Uint8Array(100 * 3);
    for (let i = 0; i < 100; i++) data.set(i < 70 ? [250, 0, 0] : [0, 0, 250], i * 3);
    const a = kmeansPalette(data, 3, 2, 9);
    expect(a).toEqual(kmeansPalette(data, 3, 2, 9));
    expect(a[0]?.share).toBeCloseTo(0.7, 5);
    expect(hexDeltaE(a[0]!.hex, "#fa0000")).toBeLessThan(3);
    expect(kmeansPalette(new Uint8Array(0), 3, 3, 1)).toEqual([]);
  });
});

describe("elo", () => {
  it("expected score is symmetric and updates conserve points", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    const [w, l] = updatePair(1000, 1000);
    expect(w).toBe(1016);
    expect(l).toBe(984);
    expect(updateNeither(ELO_START)).toBe(984);
  });
});

describe("similarity", () => {
  const unit = (x: number, y: number): number[] => l2Normalize([x, y]);
  it("normalises and measures cosine", () => {
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
    expect(cosine(unit(1, 0), unit(0, 1))).toBe(0);
    expect(centroid([])).toEqual([]);
    expect(centroid([unit(1, 0), unit(0, 1)])[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });
  it("ranks a central target high and an outlier low using leave-one-out centroids", () => {
    const others = [
      { id: "a", brandId: "A", vector: unit(1, 0.1) },
      { id: "b", brandId: "B", vector: unit(1, -0.1) },
      { id: "c", brandId: "C", vector: unit(0.9, 0) },
    ];
    const central = similarityFor({ id: "t", brandId: "T", vector: unit(1, 0) }, others);
    const outlier = similarityFor({ id: "t", brandId: "T", vector: unit(0, 1) }, others);
    expect(central.centroidPercentile).toBeGreaterThan(outlier.centroidPercentile);
    expect(outlier.centroidPercentile).toBe(0.25);
    expect(central.nearestBrandId).toBeTruthy();
    expect(similarityFor({ id: "t", brandId: "T", vector: unit(1, 0) }, []).nearestSim).toBe(0);
  });
  it("scores a variant against the competitor centroid", () => {
    const comps = [{ id: "a", brandId: "A", vector: unit(1, 0) }];
    const near = similarityOfVariant(unit(1, 0.1), comps);
    const far = similarityOfVariant(unit(0, 1), comps);
    expect(near.centroidSim).toBeGreaterThan(far.centroidSim);
    expect(near.nearestBrandId).toBe("A");
  });
});

describe("config and schemas", () => {
  it("resolves a frozen preset config", () => {
    const c = resolveConfig("free");
    expect(c.panel.callsPerCondition * c.panel.personasPerCall).toBe(12);
    expect(resolveConfig("strict").panel.personasPerCall).toBe(1);
    expect(isIdentifierKind("logo")).toBe(true);
    expect(isIdentifierKind("product")).toBe(false);
  });
  it("validates job messages and routes queues", () => {
    const id = "6f1c5b0e-8f4d-4d52-9d6b-2b3b1d5f9a10";
    const m = JobMessage.parse({ type: "run_panel_batch", analysisId: id, batchId: id, idem: "x" });
    expect(queueFor(m.type)).toBe("jobs_bulk");
    expect(queueFor("ingest_ad")).toBe("jobs_high");
    expect(JobMessage.safeParse({ type: "nope" }).success).toBe(false);
  });
  it("has a payload schema for every event type", () => {
    expect(EventPayloads.status_changed.parse({ from: "a", to: "b" })).toEqual({ from: "a", to: "b" });
    expect(Object.keys(EventPayloads)).toHaveLength(13);
  });
});
