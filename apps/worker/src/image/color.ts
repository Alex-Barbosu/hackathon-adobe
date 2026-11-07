import {
  type Lab,
  type PaletteEntry,
  type PxBox,
  type Rgb,
  deriveSeed,
  kmeansPalette,
  labToRgb,
  hexToRgb,
  rgbToLab,
} from "@nologo/core";
import { crop, resizeRaster, type Raster } from "./raster.ts";

const RING_PX = 6;
const BORDER_PX = 4;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

// Local background = per-channel median in Lab of a thin ring just outside the box.
export function localBackground(r: Raster, box: PxBox, fallback: Rgb): Rgb {
  const [y0, x0, y1, x1] = box;
  const ey0 = Math.max(0, y0 - RING_PX);
  const ex0 = Math.max(0, x0 - RING_PX);
  const ey1 = Math.min(r.height, y1 + RING_PX);
  const ex1 = Math.min(r.width, x1 + RING_PX);
  const ls: number[] = [];
  const as: number[] = [];
  const bs: number[] = [];
  for (let y = ey0; y < ey1; y++) {
    for (let x = ex0; x < ex1; x++) {
      if (y >= y0 && y < y1 && x >= x0 && x < x1) continue;
      const i = (y * r.width + x) * 3;
      const lab = rgbToLab([r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0]);
      ls.push(lab[0]);
      as.push(lab[1]);
      bs.push(lab[2]);
    }
  }
  if (ls.length === 0) return fallback;
  return labToRgb([median(ls), median(as), median(bs)]);
}

function borderStrip(r: Raster): Uint8Array {
  const out: number[] = [];
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (x < BORDER_PX || y < BORDER_PX || x >= r.width - BORDER_PX || y >= r.height - BORDER_PX) {
        const i = (y * r.width + x) * 3;
        out.push(r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0);
      }
    }
  }
  return Uint8Array.from(out);
}

// Largest cluster of the 4 px border strip.
export function dominantBackground(r: Raster, seed: number): Rgb {
  const palette = kmeansPalette(borderStrip(r), 3, 3, seed);
  const top = palette[0];
  return top ? hexToRgb(top.hex) : [255, 255, 255];
}

export async function adPalette(r: Raster, seed: number, k = 5): Promise<PaletteEntry[]> {
  const small = r.width > 128 || r.height > 128
    ? await resizeRaster(r, Math.max(1, Math.round((r.width * 128) / Math.max(r.width, r.height))), Math.max(1, Math.round((r.height * 128) / Math.max(r.width, r.height))))
    : r;
  return kmeansPalette(small.data, 3, k, deriveSeed("palette", seed));
}

// Dominant colour of a region: the largest of 3 clusters inside its box.
export function dominantInBox(r: Raster, box: PxBox, seed: number): Rgb {
  const c = crop(r, box);
  const top = kmeansPalette(c.data, 3, 3, seed)[0];
  return top ? hexToRgb(top.hex) : [128, 128, 128];
}

export type { Lab };
