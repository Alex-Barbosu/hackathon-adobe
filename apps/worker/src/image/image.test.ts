import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MASK_RGB, hexDeltaE, rgbToHex, rgbToLab, toPixels, type EditPlanValue, type NormBox, type Rgb } from "@nologo/core";
import { ablate, type AblationRegion } from "./ablate.ts";
import { adPalette, dominantBackground, localBackground } from "./color.ts";
import { GuardError, assertGuard, changeRatio, changedWithin, pixelDiffGuard } from "./guard.ts";
import { applyMasks, maskRaster, paddedPixelBoxes } from "./mask.ts";
import { downscalePng, normalizeImage } from "./normalize.ts";
import { decodePng, encodePng, pixelAt, sha256Hex, type Raster } from "./raster.ts";
import { renderPlan, type RenderRegion } from "./render.ts";
import { syntheticAd } from "./synthetic.ts";

const spec = {
  size: 400,
  background: [240, 230, 200] as Rgb,
  border: [20, 60, 120] as Rgb,
  logo: [200, 30, 30] as Rgb,
  mascot: [250, 200, 0] as Rgb,
  product: [30, 140, 60] as Rgb,
  text: [40, 40, 40] as Rgb,
};

const ad = syntheticAd(spec);
const center = (box: NormBox, size = 400): [number, number] => {
  const [y0, x0, y1, x1] = toPixels(box, size, size);
  return [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)];
};
const regionOf = (kind: string): { kind: string; box: NormBox } => {
  const r = ad.regions.find((x) => x.kind === kind);
  if (!r) throw new Error(kind);
  return r;
};
const at = (r: Raster, box: NormBox): Rgb => {
  const [x, y] = center(box, r.width);
  return pixelAt(r, x, y);
};
const identifiers = ad.regions.filter((r) => r.kind === "logo" || r.kind === "brand_name");
const masked = maskRaster(ad.raster, identifiers.map((r) => r.box));
const abRegions: AblationRegion[] = ad.regions.map((r) => ({ kind: r.kind, box: r.box }));

describe("normalize", () => {
  it("caps the long side, flattens alpha, strips metadata and is deterministic", async () => {
    const input = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
      .withExif({ IFD0: { Copyright: "ACME Brand" } })
      .png()
      .toBuffer();
    const a = await normalizeImage(input);
    const b = await normalizeImage(input);
    expect(a.width).toBe(1024);
    expect(a.height).toBe(512);
    expect(a.sha256).toBe(b.sha256);
    const meta = await sharp(a.png).metadata();
    expect(meta.hasAlpha).toBe(false);
    expect(meta.exif).toBeUndefined();
    const small = await normalizeImage(await ad.png());
    expect(small.width).toBe(400);
    expect((await downscalePng(small.png, 100)).length).toBeGreaterThan(0);
    expect((await sharp(await downscalePng(small.png, 100)).metadata()).width).toBe(100);
  });
  it("applies EXIF orientation", async () => {
    const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const n = await normalizeImage(input);
    expect([n.width, n.height]).toEqual([100, 200]);
  });
  it("round-trips PNG through the raster codec", async () => {
    const r = await decodePng(await encodePng(ad.raster));
    expect(r.width).toBe(400);
    expect(sha256Hex(r.data)).toBe(sha256Hex(ad.raster.data));
  });
});

describe("masking", () => {
  it("fills identifiers with the exact mask colour and leaves the rest alone", () => {
    expect(at(masked.raster, regionOf("logo").box)).toEqual(MASK_RGB);
    expect(at(masked.raster, regionOf("brand_name").box)).toEqual(MASK_RGB);
    expect(at(masked.raster, regionOf("product").box)).toEqual(spec.product);
    const g = pixelDiffGuard(ad.raster, masked.raster, masked.pxBoxes);
    expect(g.passed).toBe(true);
    expect(g.changedOutside).toBe(0);
    expect(g.changedInside).toBeGreaterThan(0.9);
  });
  it("pads boxes and fills overlaps as a union", () => {
    const [b] = paddedPixelBoxes([regionOf("logo").box], 400, 400);
    const [raw] = [toPixels(regionOf("logo").box, 400, 400)];
    expect(b![0]).toBeLessThan(raw[0]);
    expect(b![3]).toBeGreaterThan(raw[3]);
    const two = applyMasks(ad.raster, paddedPixelBoxes([regionOf("logo").box, regionOf("brand_name").box], 400, 400));
    expect(at(two, regionOf("logo").box)).toEqual(MASK_RGB);
  });
});

describe("ablations", () => {
  it("color: greyscale with identical mask grey", () => {
    const r = ablate(masked.raster, masked.pxBoxes, abRegions, "color", 1)!;
    const [pr, pg, pb] = at(r.raster, regionOf("mascot_character").box);
    expect(pr === pg && pg === pb).toBe(true);
    expect(pr).toBe(Math.round(0.2126 * 250 + 0.7152 * 200));
    expect(at(r.raster, regionOf("logo").box)).toEqual(MASK_RGB);
    expect(r.global).toBe(true);
  });
  it("mascot: replaced by the local background, nothing changes outside", () => {
    const r = ablate(masked.raster, masked.pxBoxes, abRegions, "mascot_character", 1)!;
    expect(at(r.raster, regionOf("mascot_character").box)).toEqual(spec.background);
    expect(at(r.raster, regionOf("product").box)).toEqual(spec.product);
    const g = pixelDiffGuard(masked.raster, r.raster, r.allowed);
    expect(g.passed).toBe(true);
    expect(g.changedInside).toBeGreaterThan(0.3);
    expect(r.transform["fill_colors"]).toEqual([rgbToHex(spec.background)]);
  });
  it("product and other_text are removed with the same method", () => {
    for (const el of ["product", "other_text"] as const) {
      const r = ablate(masked.raster, masked.pxBoxes, abRegions, el, 1)!;
      expect(at(r.raster, regionOf(el).box)).toEqual(spec.background);
      expect(pixelDiffGuard(masked.raster, r.raster, r.allowed).passed).toBe(true);
    }
  });
  it("layout: mirrors the image and re-applies masks at mirrored positions", () => {
    const r = ablate(masked.raster, masked.pxBoxes, abRegions, "layout", 1)!;
    const mascot = regionOf("mascot_character").box;
    const [x, y] = center(mascot);
    expect(pixelAt(r.raster, 400 - 1 - x, y)).toEqual(spec.mascot);
    const [lx, ly] = center(regionOf("logo").box);
    expect(pixelAt(r.raster, 400 - 1 - lx, ly)).toEqual(MASK_RGB);
    expect(pixelAt(r.raster, lx, ly)).not.toEqual(MASK_RGB);
  });
  it("skips elements without regions", () => {
    const none = abRegions.filter((r) => r.kind !== "mascot_character");
    expect(ablate(masked.raster, masked.pxBoxes, none, "mascot_character", 1)).toBeNull();
  });
  it("includes person regions in the mascot ablation only when configured", () => {
    const withPerson: AblationRegion[] = [...abRegions.filter((r) => r.kind !== "mascot_character"), { kind: "person", box: regionOf("product").box }];
    expect(ablate(masked.raster, masked.pxBoxes, withPerson, "mascot_character", 1, true)).not.toBeNull();
    expect(ablate(masked.raster, masked.pxBoxes, withPerson, "mascot_character", 1, false)).toBeNull();
  });
});

describe("guard", () => {
  it("fails when pixels change outside the allowed boxes and throws via assertGuard", () => {
    const bad = applyMasks(ad.raster, paddedPixelBoxes([regionOf("product").box], 400, 400));
    const g = pixelDiffGuard(ad.raster, bad, paddedPixelBoxes([regionOf("logo").box], 400, 400));
    expect(g.passed).toBe(false);
    expect(() => assertGuard(g, "test")).toThrow(GuardError);
    expect(pixelDiffGuard(ad.raster, bad, [], { global: true }).passed).toBe(true);
    expect(changeRatio(ad.raster, bad)).toBeGreaterThan(0.05);
    expect(changedWithin(ad.raster, bad, [toPixels(regionOf("product").box, 400, 400)])).toBeGreaterThan(0.9);
    expect(changeRatio(ad.raster, ad.raster)).toBe(0);
  });
  it("rejects mismatched sizes", () => {
    expect(() => pixelDiffGuard(ad.raster, { ...ad.raster, width: 10 }, [])).toThrow(GuardError);
  });
});

describe("colour helpers", () => {
  it("finds the border background and a palette", async () => {
    expect(dominantBackground(ad.raster, 1)).toEqual(spec.border);
    const [first] = await adPalette(ad.raster, 1, 5);
    expect(hexDeltaE(first!.hex, rgbToHex(spec.background))).toBeLessThan(5);
    const bg = localBackground(ad.raster, toPixels(regionOf("mascot_character").box, 400, 400), [0, 0, 0]);
    expect(bg).toEqual(spec.background);
    expect(localBackground(ad.raster, [0, 0, 400, 400] as never, [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("renderer", () => {
  const regions: RenderRegion[] = ad.regions.map((r, i) => ({
    ref: `R${i + 1}`,
    kind: r.kind,
    box: r.box,
    locked: false,
    isIdentifier: r.kind === "logo" || r.kind === "brand_name",
  }));
  const ref = (kind: string): string => regions.find((r) => r.kind === kind)!.ref;
  const plan = (ops: EditPlanValue["ops"]): EditPlanValue => ({ title: "t", hypothesis: "h", primaryElement: "color", directionTags: [], ops });

  it("recolors a region while keeping everything else", async () => {
    const { raster } = await renderPlan(ad.raster, plan([{ op: "recolor_region", regionId: ref("mascot_character"), targetHex: "#90e080", toleranceDE: 20 }]), regions, 1);
    const got = rgbToLab(at(raster, regionOf("mascot_character").box));
    const want = rgbToLab([0x90, 0xe0, 0x80]);
    const orig = rgbToLab(spec.mascot);
    // Luminance is preserved; only hue and chroma move to the target.
    expect(Math.abs(got[0] - orig[0])).toBeLessThan(3);
    expect(Math.hypot(got[1] - want[1], got[2] - want[2])).toBeLessThan(8);
    expect(at(raster, regionOf("product").box)).toEqual(spec.product);
    expect(at(raster, regionOf("logo").box)).toEqual(spec.logo);
  });
  it("changes the background but not regions", async () => {
    const { raster } = await renderPlan(ad.raster, plan([{ op: "change_background", targetHex: "#ffffff", toleranceDE: 15 }]), regions, 1);
    expect(pixelAt(raster, 5, 5)).not.toEqual(spec.border);
    expect(at(raster, regionOf("mascot_character").box)).toEqual(spec.mascot);
    expect(at(raster, regionOf("product").box)).toEqual(spec.product);
  });
  it("removes, moves and scales regions", async () => {
    const removed = await renderPlan(ad.raster, plan([{ op: "remove_region", regionId: ref("product") }]), regions, 1);
    expect(at(removed.raster, regionOf("product").box)).toEqual(spec.background);
    const moved = await renderPlan(ad.raster, plan([{ op: "move_region", regionId: ref("product"), dxPct: -10, dyPct: 0 }]), regions, 1);
    const [px0, py0] = center(regionOf("product").box);
    expect(pixelAt(moved.raster, px0 - 40, py0)).toEqual(spec.product);
    const scaled = await renderPlan(ad.raster, plan([{ op: "scale_region", regionId: ref("mascot_character"), factor: 0.6, anchor: "center" }]), regions, 1);
    const [mx, my] = center(regionOf("mascot_character").box);
    expect(pixelAt(scaled.raster, mx, my)).toEqual(spec.mascot);
    const [, , , edgeX] = toPixels(regionOf("mascot_character").box, 400, 400);
    expect(pixelAt(scaled.raster, edgeX - 3, my)).toEqual(spec.background);
  });
  it("adds a band and applies tone without touching identifiers", async () => {
    const band = await renderPlan(ad.raster, plan([{ op: "add_band", edge: "bottom", thicknessPct: 5, hex: "#112233" }]), regions, 1);
    expect(pixelAt(band.raster, 200, 395)).toEqual([0x11, 0x22, 0x33]);
    const toned = await renderPlan(ad.raster, plan([{ op: "tone", saturation: 0.6, contrast: 1.2 }]), regions, 1);
    expect(at(toned.raster, regionOf("mascot_character").box)).not.toEqual(spec.mascot);
    expect(at(toned.raster, regionOf("logo").box)).toEqual(spec.logo);
    expect(changedWithin(ad.raster, toned.raster, toned.protectedBoxes)).toBe(0);
    expect(changeRatio(ad.raster, toned.raster)).toBeGreaterThan(0.5);
  });
  it("is deterministic and rejects unknown regions", async () => {
    const p = plan([{ op: "recolor_region", regionId: ref("product"), targetHex: "#aa00aa", toleranceDE: 25 }]);
    const a = await renderPlan(ad.raster, p, regions, 7);
    const b = await renderPlan(ad.raster, p, regions, 7);
    expect(sha256Hex(a.raster.data)).toBe(sha256Hex(b.raster.data));
    await expect(renderPlan(ad.raster, plan([{ op: "remove_region", regionId: "R99" }]), regions, 1)).rejects.toThrow();
  });
});
