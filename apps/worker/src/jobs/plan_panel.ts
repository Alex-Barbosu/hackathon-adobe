import { must } from "../db.ts";
import { FatalError } from "../errors.ts";
import { NEAR_DUPLICATE_BITS, dHash, hamming } from "../image/phash.ts";
import { decodePng } from "../image/raster.ts";
import { assignPersonas, candidateOrder, pickExposures, type ExposureCandidate } from "../pipeline/panelplan.ts";
import { BUCKETS, download } from "../storage.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import { getAds, getAnalysis, getAnalysisAds, getBrands, requireNormalizedPath, type Analysis } from "./data.ts";

// Exposure pool: ads of each candidate brand, minus the target itself and anything that looks like it.
async function eligibleExposures(ctx: Ctx, a: Analysis): Promise<ExposureCandidate[]> {
  const links = (await getAnalysisAds(ctx.db, a.id)).filter((l) => l.role === "exposure" && l.ad_id !== a.target_ad_id);
  const ads = await getAds(ctx.db, [...new Set(links.map((l) => l.ad_id))]);
  const targetAd = (await getAds(ctx.db, [a.target_ad_id]))[0];
  if (!targetAd) throw new FatalError("Target ad missing");
  const targetHash = await dHash(await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(targetAd))));
  const out: ExposureCandidate[] = [];
  for (const ad of ads) {
    if (ad.sha256 && ad.sha256 === targetAd.sha256) continue;
    const h = await dHash(await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad))));
    // Near-duplicates of the target would leak the answer, so they never serve as exposures.
    if (hamming(h, targetHash) <= NEAR_DUPLICATE_BITS) {
      ctx.log.info({ adId: ad.id }, "excluded near-duplicate exposure");
      continue;
    }
    out.push({ adId: ad.id, brandId: ad.brand_id });
  }
  return out;
}

// 8.2 plan_panel: store everything on the batch row so each call is reproducible from the row alone.
export const planPanel: JobHandler<"plan_panel"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  const brands = await getBrands(ctx.db, a.id);
  const brandIds = brands.map((b) => b.brandId);
  const personas = must(await ctx.db.from("personas").select("id").order("id"), "personas").map((p) => p.id);
  if (personas.length === 0) throw new FatalError("No personas seeded");
  const conditions = must(await ctx.db.from("conditions").select("id, kind").in("id", msg.conditionIds), "conditions");
  const pool = await eligibleExposures(ctx, a);
  const { callsPerCondition, personasPerCall, exposuresPerBrand } = a.cfg.panel;
  const seed = a.seed % 2147483647;

  const batches = conditions
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .flatMap((c) =>
      Array.from({ length: callsPerCondition }, (_, j) => ({
        condition_id: c.id,
        batch_index: j,
        model: ctx.env.MODEL_PANEL,
        persona_ids: assignPersonas(personas, personasPerCall, j, seed),
        exposure_ad_ids: c.kind === "control_no_memory" ? [] : pickExposures(pool, brandIds, exposuresPerBrand, seed, j),
        candidate_order: candidateOrder(brandIds, seed, j),
      })),
    );
  const { data, error } = await ctx.db.rpc("register_batches", { p_analysis_id: a.id, p_batches: batches });
  if (error) throw new Error(`register_batches: ${error.message}`);
  for (const b of data ?? []) {
    await ctx.queue.send({ type: "run_panel_batch", analysisId: a.id, batchId: b.id, idem: idem("run_panel_batch", b.id) });
  }
  ctx.log.info({ analysisId: a.id, batches: data?.length ?? 0 }, "panel planned");
};
