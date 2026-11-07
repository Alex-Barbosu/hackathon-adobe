import { MASK_PAD_MIN_PX, MASK_PAD_RATIO, MASK_RGB, type NormBox, type PxBox, pad, toPixels } from "@nologo/core";
import { cloneRaster, fillRect, type Raster } from "./raster.ts";

// 11.2: pad each identifier box (8% of its larger side, min 6 px), clipped to the canvas.
export function paddedPixelBoxes(boxes: readonly NormBox[], width: number, height: number): PxBox[] {
  return boxes.map((b) => pad(toPixels(b, width, height), MASK_PAD_RATIO, MASK_PAD_MIN_PX, width, height));
}

// Flat fill, no blur or feathering: soft edges would preserve shape information. Overlaps fill the union.
export function applyMasks(r: Raster, pxBoxes: readonly PxBox[]): Raster {
  const out = cloneRaster(r);
  for (const b of pxBoxes) fillRect(out, b, MASK_RGB);
  return out;
}

export function maskRaster(r: Raster, identifierBoxes: readonly NormBox[]): { raster: Raster; pxBoxes: PxBox[] } {
  const pxBoxes = paddedPixelBoxes(identifierBoxes, r.width, r.height);
  return { raster: applyMasks(r, pxBoxes), pxBoxes };
}
