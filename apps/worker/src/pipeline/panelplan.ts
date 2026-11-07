import { rngFrom, sampleDistinct, shuffle } from "@nologo/core";

// Paired design: batch j of every condition uses the same personas, exposures and candidate order, so a
// difference between two conditions is not confounded by who looked at what. (ADR-008, a deliberate
// deviation from seeding by condition id.) The control keeps personas and order but gets no exposures.

// Round-robin through one seeded permutation of the personas, so with 12 personas, 2 batches of 6
// (or 12 batches of 1) every persona is used exactly once and usage stays balanced for any batch count.
export function assignPersonas(
  personaIds: readonly string[],
  personasPerCall: number,
  batchIndex: number,
  seed: number,
): string[] {
  const order = shuffle([...personaIds].sort(), rngFrom(seed, "personas"));
  const out: string[] = [];
  for (let i = 0; i < personasPerCall && out.length < order.length; i++) {
    const p = order[(batchIndex * personasPerCall + i) % order.length];
    if (p !== undefined && !out.includes(p)) out.push(p);
  }
  return out;
}

export function candidateOrder(brandIds: readonly string[], seed: number, batchIndex: number): string[] {
  return shuffle([...brandIds].sort(), rngFrom(seed, "order", batchIndex));
}

export interface ExposureCandidate {
  adId: string;
  brandId: string;
}

export function pickExposures(
  pool: readonly ExposureCandidate[],
  brandIds: readonly string[],
  perBrand: number,
  seed: number,
  batchIndex: number,
): string[] {
  const picked: string[] = [];
  for (const brandId of [...brandIds].sort()) {
    const ads = pool.filter((p) => p.brandId === brandId).map((p) => p.adId).sort();
    picked.push(...sampleDistinct(ads, perBrand, rngFrom(seed, "exposure", batchIndex, brandId)));
  }
  return picked;
}
