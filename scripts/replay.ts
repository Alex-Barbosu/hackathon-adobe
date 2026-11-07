// Recompute metrics and diagnosis from STORED votes with different thresholds. Zero model calls.
// Usage: tsx scripts/replay.ts [--analysis <id>] [--thresholds file.json]
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  DEFAULT_THRESHOLDS, conditionStats, deriveSeed, diagnose, elementImpactNumbers, summarize,
  type ImpactInput, type Thresholds, type Vote,
} from "@nologo/core";
import { createDb } from "../apps/worker/src/db.ts";
import { env, flag } from "./lib.ts";

const e = env(true);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const id = flag("analysis") ?? (await db.from("analyses").select("id").order("created_at", { ascending: false }).limit(1).single()).data?.id;
if (!id) throw new Error("no analysis found");
const file = flag("thresholds");
const override = file ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Thresholds>) : {};
const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...override };

const analysis = (await db.from("analyses").select("*").eq("id", id).single()).data;
if (!analysis) throw new Error("analysis not found");
const brands = (await db.from("analysis_brands").select("*").eq("analysis_id", id)).data ?? [];
const target = brands.find((b) => b.is_target)?.brand_id ?? "";
const competitors = brands.filter((b) => !b.is_target).map((b) => b.brand_id);
const keys = [...brands.map((b) => b.brand_id), "none"];
const conds = (await db.from("conditions").select("*").eq("analysis_id", id).is("variant_id", null)).data ?? [];
const rows = (await db.from("panel_votes").select("*").in("condition_id", conds.map((c) => c.id)).limit(10000)).data ?? [];

const P = z.record(z.string(), z.number());
const C = z.array(z.object({ element: z.string(), text: z.string() }));
const votesBy = new Map<string, Vote[]>();
for (const r of rows) {
  const list = votesBy.get(r.condition_id) ?? [];
  list.push({ batchId: r.batch_id, probabilities: P.parse(r.probabilities), cues: C.parse(r.cues), sawIdentifier: r.saw_identifier });
  votesBy.set(r.condition_id, list);
}
const stats = new Map(conds.flatMap((c) => {
  const v = votesBy.get(c.id);
  return v ? [[c.id, conditionStats(v, keys, deriveSeed(analysis.seed, c.id), 2000)] as const] : [];
}));
const baseline = conds.find((c) => c.kind === "baseline");
const base = baseline ? stats.get(baseline.id) : undefined;
if (!baseline || !base) throw new Error("baseline has no votes");
const control = conds.find((c) => c.kind === "control_no_memory");
const controlStats = control ? stats.get(control.id) : undefined;
const impacts: ImpactInput[] = conds.flatMap((c) => {
  const st = stats.get(c.id);
  if (c.kind !== "ablation" || !c.element || !st) return [];
  return [{ element: c.element, ...elementImpactNumbers(base, st, target, competitors) }];
});
const sim = (await db.from("similarity").select("centroid_percentile").eq("analysis_id", id).maybeSingle()).data;
const summary = summarize(base, target);
const result = diagnose({
  thresholds,
  baseline: summary,
  controlAttribution: controlStats ? summarize(controlStats, target).attribution : null,
  impacts,
  centroidPercentile: sim?.centroid_percentile ?? null,
  leakShare: summary.sawIdentifierShare,
});

const stored = new Set(((await db.from("findings").select("finding_key").eq("analysis_id", id)).data ?? []).map((f) => f.finding_key));
const replayed = new Set(result.findings.map((f) => f.findingKey));
console.log(`analysis ${id}: replayed from ${rows.length} stored votes, 0 model calls`);
console.log(`attribution ${(summary.attribution * 100).toFixed(1)}%`, "labels", JSON.stringify(result.labels));
for (const k of replayed) if (!stored.has(k)) console.log(`+ ${k}`);
for (const k of stored) if (!replayed.has(k)) console.log(`- ${k}`);
console.log(`${replayed.size} findings now, ${stored.size} stored, ${[...replayed].filter((k) => stored.has(k)).length} unchanged`);
process.exit(0);
