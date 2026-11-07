import { FatalError } from "../errors.ts";
import { transition } from "../pipeline/state.ts";
import { beginDetection } from "../pipeline/detection.ts";
import { idem, type JobHandler } from "./context.ts";
import { getAds, getAnalysis, getAnalysisAds } from "./data.ts";

// Kicks off a freshly created analysis: ingest whatever is not normalized yet, then detect.
export const startAnalysis: JobHandler<"start_analysis"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "created" && a.status !== "ingesting") return;
  const links = await getAnalysisAds(ctx.db, a.id);
  const ads = await getAds(ctx.db, [...new Set([a.target_ad_id, ...links.map((l) => l.ad_id)])]);
  const failed = ads.filter((ad) => ad.status === "failed");
  if (failed.length > 0) throw new FatalError(`${failed.length} ad(s) failed to ingest; re-upload them`);
  const pending = ads.filter((ad) => ad.status !== "normalized");
  if (pending.length === 0) {
    await beginDetection(ctx, a.id);
    return;
  }
  await transition(ctx.db, a.id, "ingesting");
  for (const ad of pending) {
    await ctx.queue.send({ type: "ingest_ad", adId: ad.id, idem: idem("ingest_ad", ad.id) });
  }
};
