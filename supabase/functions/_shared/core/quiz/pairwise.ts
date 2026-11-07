import { z } from "zod";
import { ELO_START, updateNeither, updatePair } from "../elo.ts";

export const DIRECTION_TAGS = [
  "amplify_mascot",
  "amplify_product",
  "own_a_color",
  "neutralise_traitor_color",
  "bolder_typography",
  "quieter_typography",
  "more_whitespace",
  "denser_composition",
  "brand_band_or_frame",
  "distinct_background",
  "category_convention_break",
  "warmer_tone",
  "more_premium_tone",
] as const;

export const DirectionTag = z.enum(DIRECTION_TAGS);
export type DirectionTagValue = z.infer<typeof DirectionTag>;

export type Choice = "a" | "b" | "neither";

export interface DirectionState {
  id: string;
  title: string;
  description: string;
  tags: string[];
  elo: number;
  comparisons: number;
}

export interface RoundState {
  id: string;
  index: number;
  aId: string;
  bId: string;
  choice: Choice | null;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Prefer close ratings and fresh directions: informative comparisons first. Ties go by pair key.
export function selectPair(
  directions: readonly DirectionState[],
  shown: ReadonlySet<string>,
): [DirectionState, DirectionState] | null {
  let best: { score: number; key: string; pair: [DirectionState, DirectionState] } | null = null;
  const sorted = [...directions].sort((x, y) => (x.id < y.id ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i] as DirectionState;
      const b = sorted[j] as DirectionState;
      const key = pairKey(a.id, b.id);
      if (shown.has(key)) continue;
      const score = Math.abs(a.elo - b.elo) + 60 * (a.comparisons + b.comparisons);
      if (!best || score < best.score || (score === best.score && key < best.key)) {
        best = { score, key, pair: [a, b] };
      }
    }
  }
  return best?.pair ?? null;
}

export function applyRound(
  directions: readonly DirectionState[],
  round: { aId: string; bId: string },
  choice: Choice,
): DirectionState[] {
  const get = (id: string): DirectionState => {
    const d = directions.find((x) => x.id === id);
    if (!d) throw new Error(`Unknown direction ${id}`);
    return d;
  };
  const a = get(round.aId);
  const b = get(round.bId);
  let ea = a.elo;
  let eb = b.elo;
  if (choice === "a") [ea, eb] = updatePair(a.elo, b.elo);
  else if (choice === "b") [eb, ea] = updatePair(b.elo, a.elo);
  else {
    ea = updateNeither(a.elo);
    eb = updateNeither(b.elo);
  }
  return directions.map((d) =>
    d.id === a.id
      ? { ...d, elo: ea, comparisons: d.comparisons + 1 }
      : d.id === b.id
        ? { ...d, elo: eb, comparisons: d.comparisons + 1 }
        : d,
  );
}

export interface TagPreference {
  tag: string;
  score: number;
}

// Winner-only tags +1, loser-only -1, "neither" -0.5 on every tag shown; normalised by appearances.
export function tagPreferences(
  directions: readonly DirectionState[],
  rounds: readonly RoundState[],
): TagPreference[] {
  const raw = new Map<string, number>();
  const seen = new Map<string, number>();
  const tagsOf = (id: string): Set<string> => new Set(directions.find((d) => d.id === id)?.tags ?? []);
  for (const r of rounds) {
    if (!r.choice) continue;
    const a = tagsOf(r.aId);
    const b = tagsOf(r.bId);
    const all = new Set([...a, ...b]);
    for (const t of all) seen.set(t, (seen.get(t) ?? 0) + 1);
    if (r.choice === "neither") {
      for (const t of all) raw.set(t, (raw.get(t) ?? 0) - 0.5);
      continue;
    }
    const [win, lose] = r.choice === "a" ? [a, b] : [b, a];
    for (const t of win) if (!lose.has(t)) raw.set(t, (raw.get(t) ?? 0) + 1);
    for (const t of lose) if (!win.has(t)) raw.set(t, (raw.get(t) ?? 0) - 1);
  }
  return [...seen.entries()]
    .map(([tag, n]) => ({ tag, score: (raw.get(tag) ?? 0) / n }))
    .sort((x, y) => y.score - x.score || (x.tag < y.tag ? -1 : 1));
}

export function topDirectionIds(directions: readonly DirectionState[], n = 3): string[] {
  return [...directions]
    .filter((d) => d.elo >= ELO_START && d.comparisons > 0)
    .sort((x, y) => y.elo - x.elo || (x.id < y.id ? -1 : 1))
    .slice(0, n)
    .map((d) => d.id);
}

// Polish-only briefs gain little from "this or that", so skip unless the user asked.
export function shouldSkipPairwise(changeBudget: number | undefined, requested: boolean): boolean {
  return changeBudget === 1 && !requested;
}

export function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    prev = cur;
  }
  return (prev[n] as number) / Math.max(m, n);
}

export interface RawDirection {
  title: string;
  description: string;
  tags: string[];
}

// 10.6 validation: drop unknown tags, drop emptied directions, drop near-duplicate titles
// (similarity = 1 - normalized edit distance, duplicate when above 0.8).
export function cleanDirections(raw: readonly RawDirection[]): { kept: RawDirection[]; dropped: string[] } {
  const kept: RawDirection[] = [];
  const dropped: string[] = [];
  for (const d of raw) {
    const tags = [...new Set(d.tags.filter((t) => (DIRECTION_TAGS as readonly string[]).includes(t)))];
    if (tags.length === 0) {
      dropped.push(`${d.title}: no valid tags`);
      continue;
    }
    const nt = normalizedTitle(d.title);
    if (kept.some((k) => 1 - levenshteinRatio(normalizedTitle(k.title), nt) > 0.8)) {
      dropped.push(`${d.title}: near-duplicate title`);
      continue;
    }
    kept.push({ ...d, tags });
  }
  return { kept, dropped };
}
