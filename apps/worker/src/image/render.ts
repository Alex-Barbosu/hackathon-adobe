import {
  type EditOpValue,
  type EditPlanValue,
  type NormBox,
  type PxBox,
  type Rgb,
  bandBox,
  deltaE2000,
  footprintAfter,
  hexToRgb,
  labToRgb,
  rgbToLab,
  toPixels,
} from "@nologo/core";
import { dominantBackground, dominantInBox, localBackground } from "./color.ts";
import type { ImageEditor } from "./generative.ts";
import {
  cloneRaster,
  crop,
  fillRect,
  insideAny,
  decodePng,
  encodePng,
  paste,
  resizeRaster,
  type Raster,
} from "./raster.ts";

export interface RenderRegion {
  ref: string;
  kind: string;
  box: NormBox;
  locked: boolean;
  isIdentifier: boolean;
}

export class RenderError extends Error {}

const pack = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

// Shift Lab a/b by the dominant->target difference, keep each pixel's L so shading survives.
function recolor(
  r: Raster,
  area: PxBox | null,
  exclude: readonly PxBox[],
  dominant: Rgb,
  targetHex: string,
  toleranceDE: number,
): void {
  const domLab = rgbToLab(dominant);
  const tLab = rgbToLab(hexToRgb(targetHex));
  const da = tLab[1] - domLab[1];
  const db = tLab[2] - domLab[2];
  const cache = new Map<number, Rgb | null>();
  const [y0, x0, y1, x1] = area ?? [0, 0, r.height, r.width];
  for (let y = Math.max(0, y0); y < Math.min(r.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(r.width, x1); x++) {
      if (exclude.length > 0 && insideAny(exclude, x, y)) continue;
      const i = (y * r.width + x) * 3;
      const [pr, pg, pb] = [r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0];
      const key = pack(pr, pg, pb);
      let next = cache.get(key);
      if (next === undefined) {
        const lab = rgbToLab([pr, pg, pb]);
        next = deltaE2000(lab, domLab) <= toleranceDE ? labToRgb([lab[0], lab[1] + da, lab[2] + db]) : null;
        cache.set(key, next);
      }
      if (next) r.data.set(next, i);
    }
  }
}

function tone(r: Raster, saturation: number, contrast: number): void {
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  for (let i = 0; i < r.width * r.height; i++) {
    const R = r.data[i * 3] ?? 0;
    const G = r.data[i * 3 + 1] ?? 0;
    const B = r.data[i * 3 + 2] ?? 0;
    const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const out = [R, G, B].map((c) => clamp((l + (c - l) * saturation - 128) * contrast + 128));
    r.data.set(out, i * 3);
  }
}

async function applyOp(
  r: Raster,
  op: EditOpValue,
  regions: Map<string, RenderRegion>,
  seed: number,
  editor: ImageEditor | undefined,
): Promise<void> {
  const region = "regionId" in op ? regions.get(op.regionId) : undefined;
  if ("regionId" in op && !region) throw new RenderError(`Unknown region ${op.regionId}`);
  const fallback = dominantBackground(r, seed);
  switch (op.op) {
    case "recolor_region": {
      if (!region) return;
      const box = toPixels(region.box, r.width, r.height);
      recolor(r, box, [], dominantInBox(r, box, seed), op.targetHex, op.toleranceDE);
      return;
    }
    case "change_background": {
      const all = [...regions.values()].map((g) => toPixels(g.box, r.width, r.height));
      recolor(r, null, all, fallback, op.targetHex, op.toleranceDE);
      return;
    }
    case "remove_region": {
      if (!region) return;
      const box = toPixels(region.box, r.width, r.height);
      fillRect(r, box, localBackground(r, box, fallback));
      return;
    }
    case "scale_region":
    case "move_region": {
      if (!region) return;
      const box = toPixels(region.box, r.width, r.height);
      const target = footprintAfter(op, region.box);
      if (!target) return;
      const patch = crop(r, box);
      fillRect(r, box, localBackground(r, box, fallback));
      const nb = toPixels(target, r.width, r.height);
      const resized = await resizeRaster(patch, nb[3] - nb[1], nb[2] - nb[0]);
      paste(r, resized, nb[1], nb[0]);
      return;
    }
    case "add_band": {
      fillRect(r, toPixels(bandBox(op), r.width, r.height), hexToRgb(op.hex));
      return;
    }
    case "generative_inpaint": {
      if (!region) return;
      if (!editor) throw new RenderError("generative_inpaint needs an image editor; enable ENABLE_GENERATIVE_EDITS");
      const box = toPixels(region.box, r.width, r.height);
      const patch = crop(r, box);
      const edited = await editor.edit({ png: await encodePng(patch), instruction: op.instruction, width: patch.width, height: patch.height, seed });
      // The model sees only this crop; the result is pasted back inside the region, never beyond it.
      paste(r, await resizeRaster(await decodePng(edited), patch.width, patch.height), box[1], box[0]);
      return;
    }
    case "tone":
      tone(r, op.saturation, op.contrast);
  }
}

// 14.4: render a validated plan on the UNMASKED original. Locked regions and identifiers are restored
// from the original at the end, so global ops like tone can never alter them.
export async function renderPlan(
  original: Raster,
  plan: EditPlanValue,
  regions: readonly RenderRegion[],
  seed: number,
  editor?: ImageEditor,
): Promise<{ raster: Raster; protectedBoxes: PxBox[] }> {
  const byRef = new Map(regions.map((g) => [g.ref, g]));
  const out = cloneRaster(original);
  for (const op of plan.ops) await applyOp(out, op, byRef, seed, editor);
  const protectedBoxes = regions
    .filter((g) => g.locked || g.isIdentifier)
    .map((g) => toPixels(g.box, original.width, original.height));
  for (const b of protectedBoxes) paste(out, crop(original, b), b[1], b[0]);
  return { raster: out, protectedBoxes };
}
