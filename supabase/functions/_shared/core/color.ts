import { mulberry32 } from "./prng.ts";

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

const D65 = [0.95047, 1.0, 1.08883] as const;

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

export function rgbToLab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65[0];
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / D65[1];
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / D65[2];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([l, a, b]: Lab): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * D65[0];
  const y = (l > 8 ? fy ** 3 : l / (24389 / 27)) * D65[1];
  const z = inv(fz) * D65[2];
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [fromLinear(lr), fromLinear(lg), fromLinear(lb)];
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

// CIEDE2000 (Sharma, Wu, Dalal 2005).
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number): number => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = h(b1, a1p);
  const h2p = h(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

export function hexDeltaE(a: string, b: string): number {
  return deltaE2000(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));
}

export interface PaletteEntry {
  hex: string;
  share: number;
}

// Seeded k-means in Lab over interleaved RGB bytes (any channel count >= 3). Deterministic per seed.
export function kmeansPalette(
  data: Uint8Array | Uint8ClampedArray,
  channels: number,
  k: number,
  seed: number,
  iterations = 12,
): PaletteEntry[] {
  const n = Math.floor(data.length / channels);
  if (n === 0) return [];
  const pts: Lab[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    pts.push(rgbToLab([data[o] as number, data[o + 1] as number, data[o + 2] as number]));
  }
  const rng = mulberry32(seed);
  const kk = Math.min(k, n);
  let centers: Array<[number, number, number]> = [];
  for (let c = 0; c < kk; c++) {
    const p = pts[Math.floor(rng() * n)] as Lab;
    centers.push([p[0], p[1], p[2]]);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const p = pts[i] as Lab;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const q = centers[c] as [number, number, number];
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i] as number] as number[];
      const p = pts[i] as Lab;
      s[0] = (s[0] as number) + p[0];
      s[1] = (s[1] as number) + p[1];
      s[2] = (s[2] as number) + p[2];
      s[3] = (s[3] as number) + 1;
    }
    centers = centers.map((old, c) => {
      const s = sums[c] as number[];
      const cnt = s[3] as number;
      return cnt === 0 ? old : [(s[0] as number) / cnt, (s[1] as number) / cnt, (s[2] as number) / cnt];
    });
  }
  const counts = new Array<number>(kk).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i] as number] = (counts[assign[i] as number] as number) + 1;
  return centers
    .map((c, i) => ({ hex: rgbToHex(labToRgb(c)), share: (counts[i] as number) / n }))
    .filter((e) => e.share > 0)
    .sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : 1));
}
