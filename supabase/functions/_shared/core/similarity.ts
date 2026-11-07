export function l2Normalize(v: readonly number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? [...v] : v.map((x) => x / n);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

export function centroid(vectors: ReadonlyArray<readonly number[]>): number[] {
  const first = vectors[0];
  if (!first) return [];
  const sum = new Array<number>(first.length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i] = (sum[i] as number) + (v[i] as number);
  return l2Normalize(sum);
}

export interface SimilarityItem {
  id: string;
  brandId: string;
  vector: readonly number[];
}

export interface SimilarityResult {
  nearestBrandId: string | null;
  nearestSim: number;
  centroidSim: number;
  centroidPercentile: number;
  perAd: Array<{ id: string; centroidSim: number }>;
}

// 12.6: leave-one-out centroids so a vector never counts toward the centroid it is compared with.
export function similarityFor(target: SimilarityItem, others: readonly SimilarityItem[]): SimilarityResult {
  const all = [target, ...others];
  const looSim = (item: SimilarityItem): number => {
    const rest = all.filter((x) => x.id !== item.id).map((x) => l2Normalize(x.vector));
    return cosine(l2Normalize(item.vector), centroid(rest));
  };
  const targetSim = looSim(target);
  const perAd = others.map((o) => ({ id: o.id, centroidSim: looSim(o) }));
  // Percentile among the category ads: share of ads the target is at least as central as.
  const pool = [...perAd.map((p) => p.centroidSim), targetSim];
  const below = pool.filter((s) => s <= targetSim).length;
  let nearestBrandId: string | null = null;
  let nearestSim = -Infinity;
  const t = l2Normalize(target.vector);
  for (const o of others) {
    const s = cosine(t, l2Normalize(o.vector));
    if (s > nearestSim) {
      nearestSim = s;
      nearestBrandId = o.brandId;
    }
  }
  return {
    nearestBrandId,
    nearestSim: others.length === 0 ? 0 : nearestSim,
    centroidSim: targetSim,
    centroidPercentile: below / pool.length,
    perAd,
  };
}

// For variants: same centroid (built from the category without the target), new vector.
export function similarityOfVariant(
  vector: readonly number[],
  competitors: readonly SimilarityItem[],
): { centroidSim: number; nearestSim: number; nearestBrandId: string | null } {
  const c = centroid(competitors.map((x) => l2Normalize(x.vector)));
  const v = l2Normalize(vector);
  let nearestBrandId: string | null = null;
  let nearestSim = -Infinity;
  for (const o of competitors) {
    const s = cosine(v, l2Normalize(o.vector));
    if (s > nearestSim) {
      nearestSim = s;
      nearestBrandId = o.brandId;
    }
  }
  return {
    centroidSim: cosine(v, c),
    nearestSim: competitors.length === 0 ? 0 : nearestSim,
    nearestBrandId,
  };
}
