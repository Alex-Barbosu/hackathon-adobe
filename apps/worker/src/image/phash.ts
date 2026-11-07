import { resizeRaster, type Raster } from "./raster.ts";

// 64-bit difference hash: robust to rescaling and recompression, so near-duplicates of the target can be
// kept out of the exposure set without spending a single model call (ADR-009: used instead of
// embedding cosine, which would need embeddings of every exposure ad before the panel can be planned).
export async function dHash(r: Raster): Promise<bigint> {
  const small = await resizeRaster(r, 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const lum = (px: number): number => {
        const i = (y * 9 + px) * 3;
        return 0.299 * (small.data[i] ?? 0) + 0.587 * (small.data[i + 1] ?? 0) + 0.114 * (small.data[i + 2] ?? 0);
      };
      bits = (bits << 1n) | (lum(x) > lum(x + 1) ? 1n : 0n);
    }
  }
  return bits;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

// Roughly equivalent to cosine > 0.97 on a perceptual embedding: at most 6 of 64 bits differ.
export const NEAR_DUPLICATE_BITS = 6;
