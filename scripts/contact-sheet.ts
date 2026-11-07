// Phase 3 gate: writes tmp/contact-sheet.png with the baseline, every ablation and every Edit DSL op,
// rendered on a synthetic ad, for visual review.
import { mkdir, writeFile } from "node:fs/promises";
import sharp, { type OverlayOptions } from "sharp";
import type { EditOpValue, Rgb } from "@nologo/core";
import { ablate } from "../apps/worker/src/image/ablate.ts";
import { maskRaster } from "../apps/worker/src/image/mask.ts";
import { encodePng, type Raster } from "../apps/worker/src/image/raster.ts";
import { renderPlan, type RenderRegion } from "../apps/worker/src/image/render.ts";
import { syntheticAd } from "../apps/worker/src/image/synthetic.ts";

const ad = syntheticAd({
  size: 384,
  background: [240, 230, 200] as Rgb,
  border: [20, 60, 120] as Rgb,
  logo: [200, 30, 30] as Rgb,
  mascot: [250, 200, 0] as Rgb,
  product: [30, 140, 60] as Rgb,
  text: [40, 40, 40] as Rgb,
});
const identifiers = ad.regions.filter((r) => r.kind === "logo" || r.kind === "brand_name");
const masked = maskRaster(ad.raster, identifiers.map((r) => r.box));
const regions: RenderRegion[] = ad.regions.map((r, i) => ({
  ref: `R${i + 1}`,
  kind: r.kind,
  box: r.box,
  locked: false,
  isIdentifier: identifiers.includes(r),
}));
const ref = (kind: string): string => regions.find((r) => r.kind === kind)?.ref ?? "R1";

const tiles: Array<{ label: string; raster: Raster }> = [
  { label: "original", raster: ad.raster },
  { label: "masked baseline", raster: masked.raster },
];
for (const el of ["color", "mascot_character", "product", "other_text", "layout"] as const) {
  const r = ablate(masked.raster, masked.pxBoxes, ad.regions, el, 1);
  if (r) tiles.push({ label: `ablate ${el}`, raster: r.raster });
}
const ops: EditOpValue[] = [
  { op: "recolor_region", regionId: ref("mascot_character"), targetHex: "#90e080", toleranceDE: 20 },
  { op: "change_background", targetHex: "#c8e6ff", toleranceDE: 15 },
  { op: "scale_region", regionId: ref("product"), factor: 0.7, anchor: "center" },
  { op: "move_region", regionId: ref("mascot_character"), dxPct: 10, dyPct: -5 },
  { op: "remove_region", regionId: ref("other_text") },
  { op: "add_band", edge: "bottom", thicknessPct: 8, hex: "#112233" },
  { op: "tone", saturation: 0.7, contrast: 1.15 },
];
for (const op of ops) {
  const { raster } = await renderPlan(
    ad.raster,
    { title: op.op, hypothesis: "sheet", primaryElement: "color", directionTags: [], ops: [op] },
    regions,
    1,
  );
  tiles.push({ label: `op ${op.op}`, raster });
}

const size = 384;
const cols = 4;
const labelH = 22;
const rows = Math.ceil(tiles.length / cols);
const composites: OverlayOptions[] = [];
for (const [i, t] of tiles.entries()) {
  const left = (i % cols) * size;
  const top = Math.floor(i / cols) * (size + labelH);
  composites.push({ input: await encodePng(t.raster), left, top: top + labelH });
  const svg = `<svg width="${size}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="6" y="16" font-size="14" font-family="sans-serif" fill="#222">${t.label}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left, top });
}
await mkdir("tmp", { recursive: true });
const sheet = await sharp({
  create: { width: cols * size, height: rows * (size + labelH), channels: 3, background: "#ffffff" },
})
  .composite(composites)
  .png()
  .toBuffer();
await writeFile("tmp/contact-sheet.png", sheet);
console.log(`wrote tmp/contact-sheet.png (${tiles.length} tiles)`);
