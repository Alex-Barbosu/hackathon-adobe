import { type NormBox, type RegionKind, type Rgb, norm, px, toPixels } from "@nologo/core";
import { encodePng, fillRect, newRaster, type Raster } from "./raster.ts";

export interface SyntheticSpec {
  size?: number;
  background: Rgb;
  border: Rgb;
  logo: Rgb;
  mascot: Rgb;
  product: Rgb;
  text: Rgb;
  // Mirrors mascot and product so layout differs between ads.
  flip?: boolean;
  noMascot?: boolean;
}

export interface SyntheticRegion {
  kind: RegionKind;
  label: string;
  box: NormBox;
}

export interface SyntheticAd {
  raster: Raster;
  regions: SyntheticRegion[];
  png: () => Promise<Buffer>;
}

function mirror(b: NormBox, flip: boolean): NormBox {
  return flip ? norm(b[0], 1000 - b[3], b[2], 1000 - b[1]) : b;
}

// A flat-colour "ad" with known geometry, so tests and the demo can assert exact outcomes and
// pre-approve regions without calling a model. Not photoreal on purpose.
export function syntheticAd(spec: SyntheticSpec): SyntheticAd {
  const size = spec.size ?? 512;
  const r = newRaster(size, size, spec.background);
  const flip = spec.flip === true;
  const regions: SyntheticRegion[] = [
    { kind: "logo", label: "logo block", box: norm(60, 60, 150, 260) },
    { kind: "brand_name", label: "brand name bar", box: norm(60, 300, 120, 620) },
    { kind: "product", label: "product pack", box: mirror(norm(380, 620, 820, 900), flip) },
    { kind: "other_text", label: "tagline", box: norm(860, 100, 920, 700) },
  ];
  if (spec.noMascot !== true) {
    regions.push({ kind: "mascot_character", label: "round mascot", box: mirror(norm(330, 100, 770, 480), flip) });
  }
  const colors: Record<string, Rgb> = {
    logo: spec.logo,
    brand_name: spec.logo,
    product: spec.product,
    other_text: spec.text,
    mascot_character: spec.mascot,
  };
  const border = Math.round(size * 0.03);
  for (const b of [px(0, 0, border, size), px(size - border, 0, size, size), px(0, 0, size, border), px(0, size - border, size, size)]) {
    fillRect(r, b, spec.border);
  }
  for (const g of regions) {
    const [y0, x0, y1, x1] = toPixels(g.box, size, size);
    if (g.kind === "mascot_character") {
      const cy = (y0 + y1) / 2;
      const cx = (x0 + x1) / 2;
      const rad = Math.min(y1 - y0, x1 - x0) / 2;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2) r.data.set(spec.mascot, (y * size + x) * 3);
        }
      }
    } else {
      fillRect(r, px(y0, x0, y1, x1), colors[g.kind] ?? spec.text);
    }
  }
  return { raster: r, regions, png: () => encodePng(r) };
}
