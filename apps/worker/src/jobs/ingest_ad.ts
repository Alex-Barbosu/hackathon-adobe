import { must, mustOk } from "../db.ts";
import { FatalError } from "../errors.ts";
import { normalizeImage } from "../image/normalize.ts";
import { beginDetection } from "../pipeline/detection.ts";
import { BUCKETS, download, paths, upload } from "../storage.ts";
import type { Ctx, JobHandler } from "./context.ts";
import { getAd, getAds, getAnalysisAds } from "./data.ts";

// After an ad is ready, any analysis waiting in `ingesting` whose ads are all normalized moves on.
async function advanceWaitingAnalyses(ctx: Ctx, adId: string): Promise<void> {
  const asTarget = must(await ctx.db.from("analyses").select("id").eq("target_ad_id", adId).eq("status", "ingesting"), "analyses");
  const asMember = must(await ctx.db.from("analysis_ads").select("analysis_id").eq("ad_id", adId), "analysis_ads");
  const ids = new Set([...asTarget.map((r) => r.id), ...asMember.map((r) => r.analysis_id)]);
  for (const id of ids) {
    const a = must(await ctx.db.from("analyses").select("id, status, target_ad_id").eq("id", id).single(), "analysis");
    if (a.status !== "ingesting") continue;
    const links = await getAnalysisAds(ctx.db, id);
    const ads = await getAds(ctx.db, [...new Set([a.target_ad_id, ...links.map((l) => l.ad_id)])]);
    if (ads.every((x) => x.status === "normalized")) await beginDetection(ctx, id);
  }
}

// 8.2: normalize (orientation, 1024 px cap, flatten, strip metadata), hash, dedupe, store.
export const ingestAd: JobHandler<"ingest_ad"> = async (ctx, msg) => {
  const ad = await getAd(ctx.db, msg.adId);
  if (ad.status === "normalized") {
    await advanceWaitingAnalyses(ctx, ad.id);
    return;
  }
  const original = await download(ctx.db, BUCKETS.original, ad.original_path);
  let normalized;
  try {
    normalized = await normalizeImage(original);
  } catch (err) {
    mustOk(await ctx.db.from("ads").update({ status: "failed" }).eq("id", ad.id), "mark ad failed");
    throw new FatalError(`Ad ${ad.id} is not a readable image: ${err instanceof Error ? err.message : String(err)}`);
  }
  const twin = must(
    await ctx.db
      .from("ads")
      .select("id, normalized_path")
      .eq("owner_id", ad.owner_id)
      .eq("sha256", normalized.sha256)
      .neq("id", ad.id)
      .not("normalized_path", "is", null)
      .limit(1),
    "dedupe lookup",
  )[0];
  // A duplicate links to the existing file instead of storing a second copy.
  const path = twin?.normalized_path ?? paths.normalized(ad.owner_id, ad.id);
  if (!twin) await upload(ctx.db, BUCKETS.derived, path, normalized.png);
  mustOk(
    await ctx.db
      .from("ads")
      .update({ normalized_path: path, width: normalized.width, height: normalized.height, sha256: normalized.sha256, status: "normalized" })
      .eq("id", ad.id),
    "update ad",
  );
  ctx.log.info({ adId: ad.id, deduped: Boolean(twin) }, "ad normalized");
  await advanceWaitingAnalyses(ctx, ad.id);
};
