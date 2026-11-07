import { type Element, type NormBox, type PxBox, rgbToHex, px } from "@nologo/core";
import { dominantBackground, localBackground } from "./color.ts";
import { applyMasks, paddedPixelBoxes } from "./mask.ts";
import { cloneRaster, fillRect, type Raster } from "./raster.ts";

export interface AblationRegion {
  kind: string;
  box: NormBox;
}

export interface AblationResult {
  raster: Raster;
  transform: Record<string, unknown>;
  // Pixel areas the transform may change; empty for global transforms.
  allowed: PxBox[];
  global: boolean;
}

const KINDS_BY_ELEMENT: Partial<Record<Element, readonly string[]>> = {
  mascot_character: ["mascot_character"],
  product: ["product"],
  other_text: ["other_text"],
};

function luma([r, g, b]: readonly [number, number, number]): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function grayscale(r: Raster): Raster {
  const out = cloneRaster(r);
  for (let i = 0; i < r.width * r.height; i++) {
    const g = luma([r.data[i * 3] ?? 0, r.data[i * 3 + 1] ?? 0, r.data[i * 3 + 2] ?? 0]);
    out.data.set([g, g, g], i * 3);
  }
  return out;
}

function flop(r: Raster): Raster {
  const out = cloneRaster(r);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 3;
      const d = (y * r.width + (r.width - 1 - x)) * 3;
      out.data.set(r.data.subarray(s, s + 3), d);
    }
  }
  return out;
}

function mirrorBox(b: PxBox, width: number): PxBox {
  return px(b[0], width - b[3], b[2], width - b[1]);
}

// 11.3: every ablation starts from the masked baseline. Returns null when the element does not apply.
export function ablate(
  baseline: Raster,
  maskBoxes: readonly PxBox[],
  regions: readonly AblationRegion[],
  element: Element,
  seed: number,
  includePerson = true,
): AblationResult | null {
  if (element === "color") {
    return {
      raster: applyMasks(grayscale(baseline), maskBoxes),
      transform: { element, method: "grayscale_rec709" },
      allowed: [],
      global: true,
    };
  }
  if (element === "layout") {
    const mirrored = maskBoxes.map((b) => mirrorBox(b, baseline.width));
    return {
      raster: applyMasks(flop(baseline), mirrored),
      transform: { element, method: "flop", caveat: "text becomes mirrored; identifiers are already masked" },
      allowed: [],
      global: true,
    };
  }
  const kinds = [...(KINDS_BY_ELEMENT[element] ?? [])];
  if (element === "mascot_character" && includePerson) kinds.push("person");
  const hit = regions.filter((r) => kinds.includes(r.kind));
  if (hit.length === 0) return null;
  const boxes = paddedPixelBoxes(
    hit.map((h) => h.box),
    baseline.width,
    baseline.height,
  );
  const fallback = dominantBackground(baseline, seed);
  const out = cloneRaster(baseline);
  const fills = boxes.map((b) => localBackground(baseline, b, fallback));
  boxes.forEach((b, i) => {
    fillRect(out, b, fills[i] ?? fallback);
  });
  return {
    raster: applyMasks(out, maskBoxes),
    transform: {
      element,
      regions: hit.map((h, i) => ({ kind: h.kind, box: h.box, padded: boxes[i] })),
      fill_colors: fills.map(rgbToHex),
    },
    allowed: boxes,
    global: false,
  };
}
