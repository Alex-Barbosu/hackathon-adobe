import { z } from "zod";
import { MERGE_IOU, MIN_REGION_AREA, type RegionKind } from "./config.ts";

// Branded so normalized (0..1000) and pixel boxes can never be mixed in one signature.
// Both are [ymin, xmin, ymax, xmax], the convention Gemini uses for box_2d.
export type NormBox = readonly [number, number, number, number] & { readonly __unit: "norm" };
export type PxBox = readonly [number, number, number, number] & { readonly __unit: "px" };

const NORM_MAX = 1000;

export const RawBoxSchema = z.array(z.number()).length(4);

function asNorm(b: readonly [number, number, number, number]): NormBox {
  return b as NormBox;
}
function asPx(b: readonly [number, number, number, number]): PxBox {
  return b as PxBox;
}

export function px(ymin: number, xmin: number, ymax: number, xmax: number): PxBox {
  return asPx([ymin, xmin, ymax, xmax]);
}

export function norm(ymin: number, xmin: number, ymax: number, xmax: number): NormBox {
  return asNorm([ymin, xmin, ymax, xmax]);
}

const clampN = (n: number): number => Math.min(NORM_MAX, Math.max(0, Math.round(n)));

// Models sometimes emit inverted corners or out-of-range values; swap and clamp before storing.
export function clampNorm(raw: readonly number[]): NormBox {
  const [a = 0, b = 0, c = 0, d = 0] = raw.map(clampN);
  return asNorm([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
}

export function wasInverted(raw: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = raw;
  return a > c || b > d;
}

export function area(box: NormBox | PxBox): number {
  const [ymin, xmin, ymax, xmax] = box;
  return Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
}

export function overlaps<B extends NormBox | PxBox>(a: B, b: B): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

export function intersection<B extends NormBox | PxBox>(a: B, b: B): number {
  const h = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const w = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return h > 0 && w > 0 ? h * w : 0;
}

export function iou<B extends NormBox | PxBox>(a: B, b: B): number {
  const inter = intersection(a, b);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

export function union(a: NormBox, b: NormBox): NormBox;
export function union(a: PxBox, b: PxBox): PxBox;
export function union(
  a: NormBox | PxBox,
  b: NormBox | PxBox,
): readonly [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// Floor mins and ceil maxes so a pixel touched by the box is always covered.
export function toPixels(box: NormBox, width: number, height: number): PxBox {
  const [ymin, xmin, ymax, xmax] = box;
  return asPx([
    Math.max(0, Math.floor((ymin * height) / NORM_MAX)),
    Math.max(0, Math.floor((xmin * width) / NORM_MAX)),
    Math.min(height, Math.ceil((ymax * height) / NORM_MAX)),
    Math.min(width, Math.ceil((xmax * width) / NORM_MAX)),
  ]);
}

export function toNorm(box: PxBox, width: number, height: number): NormBox {
  const [ymin, xmin, ymax, xmax] = box;
  return clampNorm([
    (ymin / height) * NORM_MAX,
    (xmin / width) * NORM_MAX,
    (ymax / height) * NORM_MAX,
    (xmax / width) * NORM_MAX,
  ]);
}

// Padding is `ratio` of the larger side, at least `minPx`, clipped to the canvas.
export function pad(box: PxBox, ratio: number, minPx: number, width: number, height: number): PxBox {
  const [ymin, xmin, ymax, xmax] = box;
  const p = Math.max(minPx, Math.ceil(Math.max(ymax - ymin, xmax - xmin) * ratio));
  return asPx([
    Math.max(0, ymin - p),
    Math.max(0, xmin - p),
    Math.min(height, ymax + p),
    Math.min(width, xmax + p),
  ]);
}

export function boxWidth(box: PxBox): number {
  return box[3] - box[1];
}
export function boxHeight(box: PxBox): number {
  return box[2] - box[0];
}

export interface DetectedRegion {
  kind: RegionKind;
  label: string;
  box: NormBox;
  confidence: number;
}

// Pure post-processing of model detections: drop slivers, merge near-duplicates of the same kind, sort.
export function postProcessDetections(raw: readonly DetectedRegion[]): DetectedRegion[] {
  const kept = raw.filter((r) => area(r.box) >= MIN_REGION_AREA);
  const merged: DetectedRegion[] = [];
  for (const r of [...kept].sort((a, b) => b.confidence - a.confidence || area(b.box) - area(a.box))) {
    const dup = merged.findIndex((m) => m.kind === r.kind && iou(m.box, r.box) > MERGE_IOU);
    if (dup === -1) {
      merged.push(r);
      continue;
    }
    const m = merged[dup] as DetectedRegion;
    merged[dup] = { ...m, box: union(m.box, r.box), confidence: Math.max(m.confidence, r.confidence) };
  }
  return merged.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : area(b.box) - area(a.box)));
}
