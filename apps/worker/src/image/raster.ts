import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PxBox, Rgb } from "@nologo/core";

// Plain interleaved RGB (3 bytes per pixel). All pixel work happens on this, never on sharp pipelines,
// so results are exact and testable.
export interface Raster {
  data: Uint8Array;
  width: number;
  height: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function newRaster(width: number, height: number, fill: Rgb): Raster {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 3);
  return { data, width, height };
}

export function cloneRaster(r: Raster): Raster {
  return { data: new Uint8Array(r.data), width: r.width, height: r.height };
}

export async function decodePng(png: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(png).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected 3 channels, got ${info.channels}`);
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

export async function encodePng(r: Raster): Promise<Buffer> {
  // PNG output carries no EXIF/XMP/ICC text: sharp drops metadata unless asked to keep it.
  return sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}

export function pixelAt(r: Raster, x: number, y: number): Rgb {
  const i = (y * r.width + x) * 3;
  return [r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0];
}

export function setPixel(r: Raster, x: number, y: number, c: Rgb): void {
  r.data.set(c, (y * r.width + x) * 3);
}

export function fillRect(r: Raster, box: PxBox, c: Rgb): void {
  const [y0, x0, y1, x1] = box;
  for (let y = Math.max(0, y0); y < Math.min(r.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(r.width, x1); x++) setPixel(r, x, y, c);
  }
}

export function insideAny(boxes: readonly PxBox[], x: number, y: number): boolean {
  return boxes.some((b) => y >= b[0] && y < b[2] && x >= b[1] && x < b[3]);
}

export function crop(r: Raster, box: PxBox): Raster {
  const [y0, x0, y1, x1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const start = ((y0 + y) * r.width + x0) * 3;
    out.set(r.data.subarray(start, start + w * 3), y * w * 3);
  }
  return { data: out, width: w, height: h };
}

export function paste(dst: Raster, src: Raster, x0: number, y0: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.width) continue;
      dst.data.set(src.data.subarray((y * src.width + x) * 3, (y * src.width + x) * 3 + 3), (dy * dst.width + dx) * 3);
    }
  }
}

export async function resizeRaster(r: Raster, width: number, height: number): Promise<Raster> {
  const { data, info } = await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .resize(Math.max(1, width), Math.max(1, height), { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}
