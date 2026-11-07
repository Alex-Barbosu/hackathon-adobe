import { postProcessDetections, clampNorm, wasInverted, type DetectedRegion } from "@nologo/core";
import { mustOk } from "../db.ts";
import { sha256Hex } from "../image/raster.ts";
import { maybeNeedsReview } from "../pipeline/detection.ts";
import * as detect from "../llm/prompts/detect.ts";
import { BUCKETS, download } from "../storage.ts";
import type { Ctx, JobHandler } from "./context.ts";
import { appendConfig, getAd, getAdLevelRegions, getAnalysis, getAnalysisRegions, requireNormalizedPath } from "./data.ts";

async function detectWithModel(ctx: Ctx, analysisId: string, adId: string): Promise<DetectedRegion[]> {
  const ad = await getAd(ctx.db, adId);
  const png = await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad));
  const res = await ctx.llm.generateJson({ ...detect.build({ png, sha256: ad.sha256 ?? sha256Hex(png) }), analysisId });
  const raw = res.data.regions.map((r) => {
    if (wasInverted(r.box_2d)) ctx.log.warn({ adId, box: r.box_2d }, "model returned inverted box; swapped");
    return { kind: r.kind, label: r.label, box: clampNorm(r.box_2d), confidence: r.confidence };
  });
  return postProcessDetections(raw);
}

async function detectTarget(ctx: Ctx, analysisId: string, adId: string): Promise<void> {
  if ((await getAnalysisRegions(ctx.db, analysisId, adId)).length > 0) return;
  const reusable = (await getAdLevelRegions(ctx.db, adId)).filter((r) => r.approved);
  if (reusable.length > 0) {
    // Previously approved detection: reuse it and skip the model call.
    mustOk(
      await ctx.db.from("regions").insert(
        reusable.map((r) => ({
          ad_id: adId,
          analysis_id: analysisId,
          kind: r.kind,
          box: [...r.box],
          label: r.label,
          confidence: 1,
          source: "manual" as const,
          approved: true,
        })),
      ),
      "copy regions",
    );
    return;
  }
  const found = await detectWithModel(ctx, analysisId, adId);
  if (found.length > 0) {
    mustOk(
      await ctx.db.from("regions").insert(
        found.map((r) => ({
          ad_id: adId,
          analysis_id: analysisId,
          kind: r.kind,
          box: [...r.box],
          label: r.label,
          confidence: r.confidence,
          source: "model" as const,
          approved: false,
        })),
      ),
      "insert regions",
    );
  }
}

// Reference ads are auto-approved: they only feed the similarity step, not the blind test itself.
async function detectReference(ctx: Ctx, analysisId: string, adId: string): Promise<void> {
  if ((await getAdLevelRegions(ctx.db, adId)).some((r) => r.approved)) return;
  const found = await detectWithModel(ctx, analysisId, adId);
  if (found.length === 0) return;
  mustOk(
    await ctx.db.from("regions").insert(
      found.map((r) => ({
        ad_id: adId,
        analysis_id: null,
        kind: r.kind,
        box: [...r.box],
        label: r.label,
        confidence: r.confidence,
        source: "model" as const,
        approved: true,
      })),
    ),
    "insert reference regions",
  );
}

export const detectRegions: JobHandler<"detect_regions"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "detecting") return;
  if (msg.adId === a.target_ad_id) await detectTarget(ctx, a.id, msg.adId);
  else await detectReference(ctx, a.id, msg.adId);
  await appendConfig(ctx.db, a.id, "refsDone", msg.adId);
  await maybeNeedsReview(ctx, a.id);
};
