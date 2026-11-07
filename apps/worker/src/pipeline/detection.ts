import { idem, type Ctx } from "../jobs/context.ts";
import { getAnalysis, getAnalysisAds, getAnalysisRegions } from "../jobs/data.ts";
import { emit } from "../events.ts";
import { transition } from "./state.ts";

// Reference ads (competitor role) need approved identifier regions before they can be masked for similarity.
export async function referenceAdIds(ctx: Ctx, analysisId: string): Promise<string[]> {
  const links = await getAnalysisAds(ctx.db, analysisId);
  return [...new Set(links.filter((l) => l.role === "competitor").map((l) => l.ad_id))];
}

export async function beginDetection(ctx: Ctx, analysisId: string): Promise<void> {
  await transition(ctx.db, analysisId, "detecting");
  const a = await getAnalysis(ctx.db, analysisId);
  // Enqueue even if another delivery already did the transition: detect_regions is idempotent.
  if (a.status !== "detecting") return;
  const ids = [a.target_ad_id, ...(await referenceAdIds(ctx, analysisId))];
  for (const adId of new Set(ids)) {
    await ctx.queue.send({ type: "detect_regions", analysisId, adId, idem: idem("detect_regions", analysisId, adId) });
  }
}

// Moves detecting -> needs_review once the target and every reference ad have been processed.
export async function maybeNeedsReview(ctx: Ctx, analysisId: string): Promise<void> {
  const a = await getAnalysis(ctx.db, analysisId);
  if (a.status !== "detecting") return;
  const needed = [a.target_ad_id, ...(await referenceAdIds(ctx, analysisId))];
  if (!needed.every((id) => a.cfg.refsDone.includes(id))) return;
  if (await transition(ctx.db, analysisId, "needs_review", ["detecting"])) {
    const regions = await getAnalysisRegions(ctx.db, analysisId, a.target_ad_id);
    await emit(ctx.db, analysisId, "regions_ready", { count: regions.length });
  }
}
