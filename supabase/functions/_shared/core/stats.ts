import { BOOTSTRAP_B } from "./config.ts";
import { mulberry32, type Rng } from "./prng.ts";

export interface Cue {
  element: string;
  text: string;
}

export interface Vote {
  batchId: string;
  // Keys are brand ids plus "none"; values sum to 1.
  probabilities: Record<string, number>;
  cues: Cue[];
  sawIdentifier: boolean;
}

export interface Normalized {
  probabilities: Record<string, number>;
  raw: Record<string, number>;
}

// 12.1: clamp negatives to 0; a zero sum becomes uniform; then divide by the sum. Raw is kept apart.
export function normalizeScores(raw: Record<string, number>): Normalized {
  const keys = Object.keys(raw);
  const clamped = keys.map((k) => Math.max(0, Number.isFinite(raw[k]) ? (raw[k] as number) : 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  const probabilities: Record<string, number> = {};
  keys.forEach((k, i) => {
    probabilities[k] = sum === 0 ? 1 / keys.length : (clamped[i] as number) / sum;
  });
  return { probabilities, raw: { ...raw } };
}

export interface PanelPerson {
  person: string;
  scores: Array<{ candidate: string; probability: number }>;
  cues: Cue[];
  saw_identifier: boolean;
}

export interface ParsedPerson {
  personaId: string;
  probabilities: Record<string, number>;
  raw: Record<string, number>;
  cues: Cue[];
  sawIdentifier: boolean;
}

export interface PanelParseResult {
  votes: ParsedPerson[];
  dropped: Array<{ person: string; reason: string }>;
  // Persona ids the model never answered for (or answered more than once).
  missing: string[];
}

// Post-validation that the schema cannot express: expected people, letter set, duplicates.
export function parsePanelPeople(
  people: readonly PanelPerson[],
  personaByLabel: Readonly<Record<string, string>>,
  letterToKey: Readonly<Record<string, string>>,
): PanelParseResult {
  const votes: ParsedPerson[] = [];
  const dropped: PanelParseResult["dropped"] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const personaId = personaByLabel[p.person];
    if (!personaId) {
      dropped.push({ person: p.person, reason: "unexpected person label" });
      continue;
    }
    if (seen.has(p.person)) {
      dropped.push({ person: p.person, reason: "duplicate person" });
      continue;
    }
    const raw: Record<string, number> = {};
    let bad: string | null = null;
    for (const s of p.scores) {
      const letter = s.candidate.trim().toUpperCase();
      const key = letterToKey[letter];
      if (!key) bad = `unknown candidate letter ${s.candidate}`;
      else if (key in raw) bad = `duplicate candidate letter ${letter}`;
      else raw[key] = s.probability;
    }
    if (bad) {
      dropped.push({ person: p.person, reason: bad });
      continue;
    }
    for (const key of Object.values(letterToKey)) raw[key] ??= 0;
    seen.add(p.person);
    const n = normalizeScores(raw);
    votes.push({
      personaId,
      probabilities: n.probabilities,
      raw: n.raw,
      cues: p.cues,
      sawIdentifier: p.saw_identifier,
    });
  }
  const missing = Object.entries(personaByLabel)
    .filter(([label]) => !seen.has(label))
    .map(([, id]) => id);
  return { votes, dropped, missing };
}

export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface ReplicatePair {
  cluster: number[];
  vote: number[];
}

export interface ConditionStats {
  nVotes: number;
  nBatches: number;
  keys: string[];
  means: Record<string, number>;
  reps: Record<string, ReplicatePair>;
  cueFreq: Record<string, number>;
  sawIdentifierShare: number;
}

function groupByBatch(votes: readonly Vote[]): Vote[][] {
  const groups = new Map<string, Vote[]>();
  for (const v of votes) {
    const g = groups.get(v.batchId);
    if (g) g.push(v);
    else groups.set(v.batchId, [v]);
  }
  return [...groups.keys()].sort().map((k) => groups.get(k) as Vote[]);
}

function replicates(
  groups: readonly Vote[][],
  all: readonly Vote[],
  key: string,
  B: number,
  rngCluster: Rng,
  rngVote: Rng,
): ReplicatePair {
  const sums = groups.map((g) => g.reduce((s, v) => s + (v.probabilities[key] ?? 0), 0));
  const counts = groups.map((g) => g.length);
  const cluster: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < groups.length; i++) {
      const j = Math.floor(rngCluster() * groups.length);
      s += sums[j] as number;
      c += counts[j] as number;
    }
    cluster.push(c === 0 ? 0 : s / c);
  }
  const vote: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < all.length; i++) {
      const v = all[Math.floor(rngVote() * all.length)] as Vote;
      s += v.probabilities[key] ?? 0;
    }
    vote.push(all.length === 0 ? 0 : s / all.length);
  }
  return { cluster: cluster.sort((a, b) => a - b), vote: vote.sort((a, b) => a - b) };
}

// 12.2 + 12.3. Seeded; one stream per (kind, key) so adding a key never shifts the others.
export function conditionStats(
  votes: readonly Vote[],
  keys: readonly string[],
  seed: number,
  B: number = BOOTSTRAP_B,
): ConditionStats {
  const groups = groupByBatch(votes);
  const means: Record<string, number> = {};
  const reps: Record<string, ReplicatePair> = {};
  const sortedKeys = [...keys].sort();
  sortedKeys.forEach((key, i) => {
    means[key] = mean(votes.map((v) => v.probabilities[key] ?? 0));
    reps[key] = replicates(
      groups,
      votes,
      key,
      B,
      mulberry32(seed ^ ((i + 1) * 0x9e3779b1)),
      mulberry32(seed ^ ((i + 1) * 0x85ebca6b) ^ 0x5bd1e995),
    );
  });
  const cueCount: Record<string, number> = {};
  for (const v of votes) {
    for (const el of new Set(v.cues.map((c) => c.element))) cueCount[el] = (cueCount[el] ?? 0) + 1;
  }
  const cueFreq: Record<string, number> = {};
  for (const [el, n] of Object.entries(cueCount)) cueFreq[el] = votes.length === 0 ? 0 : n / votes.length;
  return {
    nVotes: votes.length,
    nBatches: groups.length,
    keys: sortedKeys,
    means,
    reps,
    cueFreq,
    sawIdentifierShare: votes.length === 0 ? 0 : votes.filter((v) => v.sawIdentifier).length / votes.length,
  };
}

// The cluster interval is crude with 2 batches, so decisions use the wider of the two.
export function wideCi(pair: ReplicatePair): [number, number] {
  const lo = Math.min(percentile(pair.cluster, 0.025), percentile(pair.vote, 0.025));
  const hi = Math.max(percentile(pair.cluster, 0.975), percentile(pair.vote, 0.975));
  return [lo, hi];
}

export function diffPairs(a: ReplicatePair, b: ReplicatePair): ReplicatePair {
  const sub = (x: number[], y: number[]): number[] =>
    x.map((v, i) => v - (y[i] as number)).sort((p, q) => p - q);
  return { cluster: sub(a.cluster, b.cluster), vote: sub(a.vote, b.vote) };
}

export interface Diff {
  mean: number;
  ci: [number, number];
}

// a - b for one key. Replicates come from independent seeded streams, so subtracting is valid.
export function diffStat(a: ConditionStats, b: ConditionStats, key: string): Diff {
  const ra = a.reps[key];
  const rb = b.reps[key];
  if (!ra || !rb) throw new Error(`Missing replicate set for key ${key}`);
  return { mean: (a.means[key] ?? 0) - (b.means[key] ?? 0), ci: wideCi(diffPairs(ra, rb)) };
}

export interface ConditionSummary {
  nVotes: number;
  nBatches: number;
  attribution: number;
  attributionCi: [number, number];
  pull: Record<string, number>;
  pullCi: Record<string, [number, number]>;
  cueFreq: Record<string, number>;
  sawIdentifierShare: number;
}

export function summarize(stats: ConditionStats, targetId: string): ConditionSummary {
  const pull: Record<string, number> = {};
  const pullCi: Record<string, [number, number]> = {};
  for (const key of stats.keys) {
    if (key === targetId) continue;
    pull[key] = stats.means[key] ?? 0;
    pullCi[key] = wideCi(stats.reps[key] as ReplicatePair);
  }
  return {
    nVotes: stats.nVotes,
    nBatches: stats.nBatches,
    attribution: stats.means[targetId] ?? 0,
    attributionCi: wideCi(stats.reps[targetId] as ReplicatePair),
    pull,
    pullCi,
    cueFreq: stats.cueFreq,
    sawIdentifierShare: stats.sawIdentifierShare,
  };
}

export interface ImpactNumbers {
  delta: number;
  deltaCi: [number, number];
  pullShift: Record<string, number>;
  pullShiftCi: Record<string, [number, number]>;
}

// 12.4: delta(e) = attribution(baseline) - attribution(without e); pull shifts likewise.
export function elementImpactNumbers(
  baseline: ConditionStats,
  ablated: ConditionStats,
  targetId: string,
  competitorIds: readonly string[],
): ImpactNumbers {
  const d = diffStat(baseline, ablated, targetId);
  const pullShift: Record<string, number> = {};
  const pullShiftCi: Record<string, [number, number]> = {};
  for (const b of [...competitorIds, "none"]) {
    const s = diffStat(baseline, ablated, b);
    pullShift[b] = s.mean;
    pullShiftCi[b] = s.ci;
  }
  return { delta: d.mean, deltaCi: d.ci, pullShift, pullShiftCi };
}
