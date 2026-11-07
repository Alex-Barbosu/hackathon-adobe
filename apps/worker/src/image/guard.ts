import { GUARD_MAX_CHANGED_OUTSIDE, GUARD_PIXEL_THRESHOLD, type PxBox } from "@nologo/core";
import { insideAny, type Raster } from "./raster.ts";

export interface GuardResult {
  changedOutside: number;
  changedInside: number;
  global: boolean;
  passed: boolean;
}

export class GuardError extends Error {}

function assertSameSize(a: Raster, b: Raster): void {
  if (a.width !== b.width || a.height !== b.height) throw new GuardError("guard: rasters differ in size");
}

function changed(a: Raster, b: Raster, i: number): boolean {
  const d =
    Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)) +
    Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)) +
    Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
  return d > GUARD_PIXEL_THRESHOLD;
}

// 11.4: share of changed pixels outside and inside the allowed boxes. Global transforms skip the check.
export function pixelDiffGuard(
  before: Raster,
  after: Raster,
  allowed: readonly PxBox[],
  opts: { global?: boolean } = {},
): GuardResult {
  assertSameSize(before, after);
  let outsideTotal = 0;
  let outsideChanged = 0;
  let insideTotal = 0;
  let insideChanged = 0;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const isIn = insideAny(allowed, x, y);
      const c = changed(before, after, (y * before.width + x) * 3);
      if (isIn) {
        insideTotal++;
        if (c) insideChanged++;
      } else {
        outsideTotal++;
        if (c) outsideChanged++;
      }
    }
  }
  const changedOutside = outsideTotal === 0 ? 0 : outsideChanged / outsideTotal;
  const changedInside = insideTotal === 0 ? 0 : insideChanged / insideTotal;
  const global = opts.global === true;
  return { changedOutside, changedInside, global, passed: global || changedOutside <= GUARD_MAX_CHANGED_OUTSIDE };
}

// Share of all pixels that differ at all (used for the change budget).
export function changeRatio(before: Raster, after: Raster): number {
  assertSameSize(before, after);
  let n = 0;
  const total = before.width * before.height;
  for (let i = 0; i < total; i++) if (changed(before, after, i * 3)) n++;
  return total === 0 ? 0 : n / total;
}

// Share of pixels inside the given boxes that changed.
export function changedWithin(before: Raster, after: Raster, boxes: readonly PxBox[]): number {
  assertSameSize(before, after);
  let total = 0;
  let n = 0;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      if (!insideAny(boxes, x, y)) continue;
      total++;
      if (changed(before, after, (y * before.width + x) * 3)) n++;
    }
  }
  return total === 0 ? 0 : n / total;
}

export function assertGuard(result: GuardResult, what: string): void {
  if (!result.passed) {
    throw new GuardError(`${what}: ${(result.changedOutside * 100).toFixed(2)}% of pixels changed outside the allowed area`);
  }
}
