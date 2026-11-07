import { randomUUID } from "node:crypto";
import { type Element, type NormBox, type PxBox } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { ablate } from "../image/ablate.ts";
import { assertGuard, pixelDiffGuard } from "../image/guard.ts";
import { maskRaster } from "../image/mask.ts";
import { decodePng, encodePng, sha256Hex, type Raster } from "../image/raster.ts";
import { transition } from "../pipeline/state.ts";
import { BUCKETS, download, paths, upload } from "../storage.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import {
  getAd,
  getAdLevelRegions,
  getAnalysis,
  getAnalysisRegions,
  mergeConfig,
  requireNormalizedPath,
  type Analysis,
  type Row,
} from "./data.ts";

interface Built {
  id: string;
  kind: Row<"conditions">["kind"];
  element: Row<"conditions">["element"];
  png: Uint8Array;
  sha: string;
  transform: Record<string, unknown>;
  guard: Record<string, unknown>;
}

async function ensureCondition(
  ctx: Ctx,
  a: Analysis,
  kind: Row<"conditions">["kind"],
  element: Row<"conditions">["element"],
  make: () => Promise<Omit<Built, "id" | "kind" | "element">>,
): Promise<string> {
  const q = ctx.db.from("conditions").select("id").eq("analysis_id", a.id).eq("kind", kind);
  const existing = must(await (element ? q.eq("element", element) : q.is("element", null)).is("variant_id", null), "conditions")[0];
  if (existing) return existing.id;
  const built = await make();
  const id = randomUUID();
  const path = paths.condition(a.owner_id, a.id, id);
  await upload(ctx.db, BUCKETS.derived, path, built.png);
  mustOk(
    await ctx.db.from("conditions").insert({
      id,
      analysis_id: a.id,
      kind,
      element,
      image_path: path,
      image_sha256: built.sha,
      transform: toJson(built.transform),
      guard: toJson(built.guard),
    }),
    "insert condition",
  );
  await emit(ctx.db, a.id, "condition_built", { conditionId: id, kind, element });
  return id;
}

async function buildOwnConditions(ctx: Ctx, a: Analysis): Promise<string[]> {
  const ad = await getAd(ctx.db, a.target_ad_id);
  const raster = await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad)));
  const regions = (await getAnalysisRegions(ctx.db, a.id, ad.id)).filter((r) => r.approved);
  const identifiers: NormBox[] = regions.filter((r) => r.isIdentifier).map((r) => r.box);
  const masked = maskRaster(raster, identifiers);
  const baselinePng = await encodePng(masked.raster);
  const baselineSha = sha256Hex(baselinePng);
  const ids: string[] = [];

  const baselineId = await ensureCondition(ctx, a, "baseline", null, () =>
    Promise.resolve({
      png: baselinePng,
      sha: baselineSha,
      transform: { mask_color: "#8C8F93", mask_boxes: masked.pxBoxes },
      guard: {},
    }),
  );
  ids.push(baselineId);

  const skipped: Element[] = [];
  for (const el of a.cfg.elements) {
    const result = ablate(masked.raster, masked.pxBoxes, regions, el, a.seed % 2147483647, a.cfg.includePersonInPeopleAblation);
    if (!result) {
      skipped.push(el);
      continue;
    }
    const guard = pixelDiffGuard(masked.raster, result.raster, result.allowed, { global: result.global });
    // A failed guard means a bug in the transform: fail loudly rather than test a corrupted image.
    assertGuard(guard, `ablation ${el}`);
    ids.push(
      await ensureCondition(ctx, a, "ablation", el, async () => {
        const png = await encodePng(result.raster);
        return { png, sha: sha256Hex(png), transform: result.transform, guard: { ...guard } };
      }),
    );
  }
  if (skipped.length > 0) await mergeConfig(ctx.db, a.id, { skippedElements: skipped });

  // Same pixels as the baseline: it only differs by what the panel remembers.
  ids.push(
    await ensureCondition(ctx, a, "control_no_memory", null, () =>
      Promise.resolve({ png: baselinePng, sha: baselineSha, transform: { same_as: "baseline" }, guard: {} }),
    ),
  );
  return ids;
}

// Masked versions of the competitor reference ads feed the similarity step (11.2 applies to them too).
async function buildReferences(ctx: Ctx, a: Analysis): Promise<string[]> {
  const links = must(await ctx.db.from("analysis_ads").select("ad_id").eq("analysis_id", a.id).eq("role", "competitor"), "refs");
  const adIds: string[] = [];
  for (const { ad_id } of links) {
    const ad = await getAd(ctx.db, ad_id);
    const raster: Raster = await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad)));
    const regions = (await getAdLevelRegions(ctx.db, ad_id)).filter((r) => r.approved && r.isIdentifier);
    const masked = maskRaster(raster, regions.map((r) => r.box));
    await upload(ctx.db, BUCKETS.derived, paths.maskedAd(ad.owner_id, ad.id), await encodePng(masked.raster));
    adIds.push(ad_id);
  }
  return adIds;
}

export const buildConditions: JobHandler<"build_conditions"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "masking" && a.status !== "testing") return;
  const conditionIds = await buildOwnConditions(ctx, a);
  const refAds = await buildReferences(ctx, a);
  const baseline = must(
    await ctx.db.from("conditions").select("id").eq("analysis_id", a.id).eq("kind", "baseline").single(),
    "baseline condition",
  );
  for (const adId of refAds) {
    await ctx.queue.send({ type: "embed", analysisId: a.id, subjectType: "ad_masked", subjectId: adId, idem: idem("embed", "ad", adId) });
  }
  await ctx.queue.send({ type: "embed", analysisId: a.id, subjectType: "condition", subjectId: baseline.id, idem: idem("embed", "cond", baseline.id) });
  await transition(ctx.db, a.id, "testing");
  await ctx.queue.send({ type: "plan_panel", analysisId: a.id, conditionIds, idem: idem("plan_panel", a.id, "initial") });
};

export type { PxBox };
