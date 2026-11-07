import { z } from "zod";
import {
  conditionStats,
  deriveSeed,
  diffStat,
  elementImpactNumbers,
  similarityFor,
  similarityOfVariant,
  summarize,
  type ConditionStats,
  type SimilarityItem,
  type Vote,
} from "@nologo/core";
import { must, mustOk, toJson, type Db } from "../db.ts";
import { emit } from "../events.ts";
import { transition } from "../pipeline/state.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import { CueList, NumberRecord, getAnalysis, getBrands, parseJson, targetBrandId, type Analysis } from "./data.ts";

const MAX_WAIT_TRIES = 24;
const WAIT_SECONDS = 5;

async function loadVotes(db: Db, conditionIds: string[]): Promise<Map<string, Vote[]>> {
  const out = new Map<string, Vote[]>(conditionIds.map((id) => [id, []]));
  if (conditionIds.length === 0) return out;
  const rows = must(await db.from("panel_votes").select("*").in("condition_id", conditionIds).limit(10000), "panel_votes");
  for (const r of rows) {
    out.get(r.condition_id)?.push({
      batchId: r.batch_id,
      probabilities: parseJson(NumberRecord, r.probabilities, "vote probabilities"),
      cues: parseJson(CueList, r.cues, "vote cues"),
      sawIdentifier: r.saw_identifier,
    });
  }
  return out;
}

const NumberArray = z.array(z.number());

function parseVector(text: string): number[] {
  return parseJson(NumberArray, JSON.parse(text), "embedding");
}

async function loadEmbeddings(db: Db, type: "ad_masked" | "condition", ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (ids.length === 0) return out;
  const rows = must(await db.from("embeddings").select("subject_id, embedding").eq("subject_type", type).in("subject_id", ids), "embeddings");
  for (const r of rows) out.set(r.subject_id, parseVector(r.embedding));
  return out;
}

async function competitorItems(ctx: Ctx, a: Analysis, brandOf: Map<string, string>): Promise<SimilarityItem[]> {
  const refs = must(await ctx.db.from("analysis_ads").select("ad_id").eq("analysis_id", a.id).eq("role", "competitor"), "refs").map((r) => r.ad_id);
  const ads = must(await ctx.db.from("ads").select("id, brand_id").in("id", refs), "ads");
  const vecs = await loadEmbeddings(ctx.db, "ad_masked", refs);
  return ads.flatMap((ad) => {
    const vector = vecs.get(ad.id);
    return vector && brandOf.has(ad.brand_id) ? [{ id: ad.id, brandId: ad.brand_id, vector }] : [];
  });
}

async function persistMetrics(db: Db, a: Analysis, conditionId: string, stats: ConditionStats, target: string): Promise<void> {
  const s = summarize(stats, target);
  mustOk(
    await db.from("condition_metrics").upsert({
      condition_id: conditionId,
      analysis_id: a.id,
      n_votes: s.nVotes,
      n_batches: s.nBatches,
      attribution: s.attribution,
      attribution_ci: [...s.attributionCi],
      pull: toJson(s.pull),
      pull_ci: toJson(s.pullCi),
      cue_freq: toJson(s.cueFreq),
    }),
    "condition_metrics",
  );
}

// Wait for the embeddings this phase needs; give up after a bounded number of tries and continue without.
async function embeddingsReady(ctx: Ctx, msg: { analysisId: string; phase: "initial" | "retest"; idem: string }, needed: Array<{ type: "ad_masked" | "condition"; id: string }>): Promise<boolean> {
  const have = new Set<string>();
  for (const type of ["ad_masked", "condition"] as const) {
    const ids = needed.filter((n) => n.type === type).map((n) => n.id);
    for (const id of (await loadEmbeddings(ctx.db, type, ids)).keys()) have.add(id);
  }
  if (needed.every((n) => have.has(n.id))) return true;
  const tries = Number(msg.idem.split(":").pop() ?? "0");
  if (tries >= MAX_WAIT_TRIES) {
    ctx.log.warn({ analysisId: msg.analysisId }, "embeddings missing; continuing without similarity");
    return true;
  }
  await ctx.queue.send(
    { type: "aggregate", analysisId: msg.analysisId, phase: msg.phase, idem: idem("aggregate", msg.analysisId, msg.phase, String(tries + 1)) },
    WAIT_SECONDS,
  );
  return false;
}

async function aggregateInitial(ctx: Ctx, a: Analysis, msg: { analysisId: string; phase: "initial" | "retest"; idem: string }): Promise<void> {
  const brands = await getBrands(ctx.db, a.id);
  const target = targetBrandId(brands);
  const competitors = brands.filter((b) => !b.isTarget).map((b) => b.brandId);
  const keys = [...brands.map((b) => b.brandId), "none"];
  const conds = must(await ctx.db.from("conditions").select("*").eq("analysis_id", a.id).is("variant_id", null), "conditions");
  const baseline = conds.find((c) => c.kind === "baseline");
  if (!baseline) throw new Error("No baseline condition");

  const refs = must(await ctx.db.from("analysis_ads").select("ad_id").eq("analysis_id", a.id).eq("role", "competitor"), "refs");
  const ready = await embeddingsReady(ctx, msg, [
    { type: "condition", id: baseline.id },
    ...refs.map((r) => ({ type: "ad_masked" as const, id: r.ad_id })),
  ]);
  if (!ready) return;

  const votes = await loadVotes(ctx.db, conds.map((c) => c.id));
  const stats = new Map<string, ConditionStats>();
  for (const c of conds) {
    const v = votes.get(c.id) ?? [];
    if (v.length === 0) continue;
    const st = conditionStats(v, keys, deriveSeed(a.seed, c.id), a.cfg.bootstrapB);
    stats.set(c.id, st);
    await persistMetrics(ctx.db, a, c.id, st, target);
  }
  const baseStats = stats.get(baseline.id);
  if (!baseStats) throw new Error("Baseline has no votes; cannot aggregate");
  for (const c of conds.filter((x) => x.kind === "ablation" && x.element)) {
    const st = stats.get(c.id);
    if (!st || !c.element) continue;
    const n = elementImpactNumbers(baseStats, st, target, competitors);
    mustOk(
      await ctx.db.from("element_impacts").upsert({
        analysis_id: a.id,
        element: c.element,
        delta: n.delta,
        delta_ci: [...n.deltaCi],
        pull_shift: toJson(n.pullShift),
        pull_shift_ci: toJson(n.pullShiftCi),
        label: "neutral",
      }),
      "element_impacts",
    );
  }

  const brandOf = new Map(brands.map((b) => [b.brandId, b.label]));
  const others = await competitorItems(ctx, a, brandOf);
  const targetVec = (await loadEmbeddings(ctx.db, "condition", [baseline.id])).get(baseline.id);
  if (targetVec && others.length > 0) {
    const sim = similarityFor({ id: baseline.id, brandId: target, vector: targetVec }, others);
    mustOk(
      await ctx.db.from("similarity").upsert({
        analysis_id: a.id,
        nearest_brand_id: sim.nearestBrandId,
        nearest_sim: sim.nearestSim,
        centroid_sim: sim.centroidSim,
        centroid_percentile: sim.centroidPercentile,
        details: toJson({ perAd: sim.perAd, nReferences: others.length }),
      }),
      "similarity",
    );
  }
  await emit(ctx.db, a.id, "metrics_ready", {});
  await ctx.queue.send({ type: "diagnose", analysisId: a.id, idem: idem("diagnose", a.id) });
}

async function aggregateRetest(ctx: Ctx, a: Analysis, msg: { analysisId: string; phase: "initial" | "retest"; idem: string }): Promise<void> {
  const brands = await getBrands(ctx.db, a.id);
  const target = targetBrandId(brands);
  const keys = [...brands.map((b) => b.brandId), "none"];
  const baseline = must(await ctx.db.from("conditions").select("*").eq("analysis_id", a.id).eq("kind", "baseline").single(), "baseline");
  const variantConds = must(await ctx.db.from("conditions").select("*").eq("analysis_id", a.id).eq("kind", "variant"), "variant conditions");
  const ready = await embeddingsReady(ctx, msg, variantConds.map((c) => ({ type: "condition" as const, id: c.id })));
  if (!ready) return;

  const votes = await loadVotes(ctx.db, [baseline.id, ...variantConds.map((c) => c.id)]);
  const baseStats = conditionStats(votes.get(baseline.id) ?? [], keys, deriveSeed(a.seed, baseline.id), a.cfg.bootstrapB);
  const brief = (await ctx.db.from("creative_briefs").select("brief").eq("analysis_id", a.id).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  const escapeId = brief ? z.object({ competitorToEscape: z.string().nullable() }).parse(brief.brief).competitorToEscape : null;

  const brandOf = new Map(brands.map((b) => [b.brandId, b.label]));
  const others = await competitorItems(ctx, a, brandOf);
  const vecs = await loadEmbeddings(ctx.db, "condition", [baseline.id, ...variantConds.map((c) => c.id)]);
  const baseVec = vecs.get(baseline.id);
  const baseSim = baseVec && others.length > 0 ? similarityOfVariant(baseVec, others) : null;

  for (const c of variantConds) {
    const v = votes.get(c.id) ?? [];
    if (v.length === 0 || !c.variant_id) continue;
    const st = conditionStats(v, keys, deriveSeed(a.seed, c.id), a.cfg.bootstrapB);
    await persistMetrics(ctx.db, a, c.id, st, target);
    const summary = summarize(st, target);
    const delta = diffStat(st, baseStats, target);
    const escape = escapeId ? diffStat(st, baseStats, escapeId) : null;
    const vec = vecs.get(c.id);
    const sim = vec && others.length > 0 ? similarityOfVariant(vec, others) : null;
    const metrics = {
      attribution: summary.attribution,
      attributionCi: summary.attributionCi,
      baselineAttribution: baseStats.means[target] ?? 0,
      delta: delta.mean,
      deltaCi: delta.ci,
      escapePullChange: escape?.mean ?? null,
      escapePullChangeCi: escape?.ci ?? null,
      similarity:
        sim && baseSim
          ? {
              centroidSim: sim.centroidSim,
              baselineCentroidSim: baseSim.centroidSim,
              centroidSimChange: sim.centroidSim - baseSim.centroidSim,
              nearestSimChange: sim.nearestSim - baseSim.nearestSim,
            }
          : null,
      winsOnAttribution: delta.ci[0] > 0,
    };
    mustOk(await ctx.db.from("variants").update({ metrics: toJson(metrics), status: "tested" }).eq("id", c.variant_id), "variant metrics");
  }
  await emit(ctx.db, a.id, "metrics_ready", {});
  await ctx.queue.send({ type: "brand_fit", analysisId: a.id, idem: idem("brand_fit", a.id) });
}

export const aggregate: JobHandler<"aggregate"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (msg.phase === "initial") {
    if (a.status !== "testing" && a.status !== "aggregating") return;
    await transition(ctx.db, a.id, "aggregating");
    await aggregateInitial(ctx, a, msg);
  } else {
    if (a.status !== "retesting") return;
    await aggregateRetest(ctx, a, msg);
  }
};
