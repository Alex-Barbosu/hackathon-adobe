import type { Rgb } from "@nologo/core";
import { syntheticAd, type SyntheticSpec } from "../apps/worker/src/image/synthetic.ts";

// Synthetic brands so the demo needs no copyrighted ads. Each brand has its own palette and mascot.
export interface DemoBrand {
  slug: string;
  name: string;
  spec: Omit<SyntheticSpec, "flip" | "size">;
}

const c = (r: number, g: number, b: number): Rgb => [r, g, b];

export const CATEGORY = "snack bars";

export const DEMO_BRANDS: DemoBrand[] = [
  { slug: "sunny", name: "Sunny", spec: { background: c(250, 240, 200), border: c(240, 170, 0), logo: c(200, 90, 0), mascot: c(250, 200, 0), product: c(210, 120, 20), text: c(60, 40, 20) } },
  { slug: "zest", name: "Zest", spec: { background: c(230, 245, 225), border: c(30, 140, 60), logo: c(20, 100, 40), mascot: c(120, 200, 60), product: c(40, 160, 80), text: c(20, 60, 30) } },
  { slug: "nova", name: "Nova", spec: { background: c(225, 230, 250), border: c(40, 60, 160), logo: c(30, 40, 120), mascot: c(90, 120, 230), product: c(60, 80, 200), text: c(20, 30, 80) } },
  { slug: "rouge", name: "Rouge", spec: { background: c(250, 225, 225), border: c(170, 30, 40), logo: c(140, 20, 30), mascot: c(230, 80, 90), product: c(190, 40, 50), text: c(80, 20, 25) } },
];

export function adsFor(brand: DemoBrand, count: number): ReturnType<typeof syntheticAd>[] {
  return Array.from({ length: count }, (_, i) =>
    syntheticAd({
      ...brand.spec,
      size: 512,
      flip: i % 2 === 1,
      // Slight background drift per ad so the exposure pool is not made of identical images.
      background: c(Math.max(0, brand.spec.background[0] - i * 4), Math.max(0, brand.spec.background[1] - i * 3), Math.max(0, brand.spec.background[2] - i * 4)),
    }),
  );
}
