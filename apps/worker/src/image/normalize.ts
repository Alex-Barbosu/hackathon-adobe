import sharp from "sharp";
import { NORMALIZED_LONG_SIDE } from "@nologo/core";
import { sha256Hex } from "./raster.ts";

export interface Normalized {
  png: Buffer;
  width: number;
  height: number;
  sha256: string;
}

// 8.2 ingest: apply EXIF orientation, cap the long side, flatten alpha onto white, drop all metadata
// (EXIF/XMP/ICC text can name the brand), emit PNG.
export async function normalizeImage(input: Uint8Array, longSide: number = NORMALIZED_LONG_SIDE): Promise<Normalized> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height, sha256: sha256Hex(data) };
}

// Exposure images are shown at a smaller size to save tokens.
export async function downscalePng(png: Uint8Array, longSide: number): Promise<Buffer> {
  return sharp(png).resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true }).png().toBuffer();
}
