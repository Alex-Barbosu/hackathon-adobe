import { randomUUID } from "node:crypto";
import { CHANGE_CAPS, CreativeBrief, EditPlan, GUARD_MAX_CHANGED_OUTSIDE } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { FatalError } from "../errors.ts";
import { changeRatio, changedWithin } from "../image/guard.ts";
import { applyMasks, paddedPixelBoxes } from "../image/mask.ts";
import { decodePng, encodePng, sha256Hex } from "../image/raster.ts";
import { renderPlan } from "../image/render.ts";
import { buildRefs } from "../pipeline/regionrefs.ts";
import { transition } from "../pipeline/state.ts";
import { BUCKETS, download, paths, upload } from "../storage.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import { getAd, getAnalysis, getAnalysisRegions, parseJson, requireNormalizedPath, type Analysis } from "./data.ts";

async function setStatus(ctx: Ctx, a: Analysis, id: string, status: "rejected" | "failed", reasons: string[]): Promise<void> {
  mustOk(await ctx.db.from("variants").update({ status, rejection_reasons: toJson(reasons) }).eq("id", id), "reject variant");
  await emit(ctx.db, a.id, "variant_rendered", { variantId: id, status });
}

// When every variant has been handled, retest the rendered ones (or go straight on if none survived).
async function advanceIfDone(ctx: Ctx, a: Analysis): Promise<void> {
  const all = must(await ctx.db.from("variants").select("id, status").eq("analysis_id", a.id), "variants");
  if (all.some((v) => v.status === "planned")) return;
  const rendered = all.filter((v) => v.status === "rendered").map((v) => v.id);
  await transition(ctx.db, a.id, "retesting");
  if (rendered.length === 0) {
    await ctx.queue.send({ type: "brand_fit", analysisId: a.id, idem: idem("brand_fit", a.id) });
    return;
  }
  const conds = must(await ctx.db.from("conditions").select("id").eq("analysis_id", a.id).eq("kind", "variant").in("variant_id", rendered), "variant conditions");
  const ids = conds.map((c) => c.id);
  for (const id of ids) {
    await ctx.queue.send({ type: "embed", analysisId: a.id, subjectType: "condition", subjectId: id, idem: idem("embed", "cond", id) });
  }
  await ctx.queue.send({ type: "plan_panel", analysisId: a.id, conditionIds: ids, idem: idem("plan_panel", a.id, "retest") });
}

// 14.4: render on the unmasked original, enforce the change budget and the locked-region guard,
// then apply the identical identifier masks to get the variant the panel will see.
export const renderVariant: JobHandler<"render_variant"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  const variant = must(await ctx.db.from("variants").select("*").eq("id", msg.variantId).single(), "variant");
  if (variant.status !== "planned") {
    await advanceIfDone(ctx, a);
    return;
  }
  const brief = parseJson(CreativeBrief, must(await ctx.db.from("creative_briefs").select("brief").eq("id", variant.brief_id).single(), "brief").brief, "brief");
  const plan = parseJson(EditPlan, variant.plan, "edit plan");
  const ad = await getAd(ctx.db, a.target_ad_id);
  const original = await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad)));
  const regions = await getAnalysisRegions(ctx.db, a.id, ad.id);
  const refs = buildRefs(regions, brief.lockedRegionIds);

  const { raster, protectedBoxes } = await renderPlan(original, plan, refs, a.seed % 2147483647);
  const lockedChanged = changedWithin(original, raster, protectedBoxes);
  if (lockedChanged > GUARD_MAX_CHANGED_OUTSIDE) {
    mustOk(await ctx.db.from("variants").update({ status: "failed" }).eq("id", variant.id), "fail variant");
    throw new FatalError(`Renderer changed ${(lockedChanged * 100).toFixed(2)}% of locked pixels (variant ${variant.idx})`);
  }
  const ratio = changeRatio(original, raster);
  const cap = CHANGE_CAPS[brief.changeBudget] ?? 0.35;
  if (ratio > cap) {
    mustOk(await ctx.db.from("variants").update({ change_ratio: ratio }).eq("id", variant.id), "store ratio");
    await setStatus(ctx, a, variant.id, "rejected", [`over_change_budget: changed ${(ratio * 100).toFixed(1)}% of pixels, budget ${brief.changeBudget} allows ${(cap * 100).toFixed(0)}%`]);
    await advanceIfDone(ctx, a);
    return;
  }

  const renderPath = paths.variantOriginal(a.owner_id, a.id, variant.id);
  await upload(ctx.db, BUCKETS.derived, renderPath, await encodePng(raster));
  const identifiers = regions.filter((r) => r.approved && r.isIdentifier).map((r) => r.box);
  const maskBoxes = paddedPixelBoxes(identifiers, raster.width, raster.height);
  const maskedPng = await encodePng(applyMasks(raster, maskBoxes));
  const conditionId = randomUUID();
  const condPath = paths.condition(a.owner_id, a.id, conditionId);
  await upload(ctx.db, BUCKETS.derived, condPath, maskedPng);
  const existing = must(await ctx.db.from("conditions").select("id").eq("analysis_id", a.id).eq("variant_id", variant.id), "variant condition");
  if (existing.length === 0) {
    mustOk(
      await ctx.db.from("conditions").insert({
        id: conditionId,
        analysis_id: a.id,
        kind: "variant",
        element: null,
        variant_id: variant.id,
        image_path: condPath,
        image_sha256: sha256Hex(maskedPng),
        transform: toJson({ plan, change_ratio: ratio }),
        guard: toJson({ lockedChanged, global: false }),
      }),
      "insert variant condition",
    );
  }
  mustOk(
    await ctx.db.from("variants").update({ status: "rendered", original_render_path: renderPath, change_ratio: ratio }).eq("id", variant.id),
    "update variant",
  );
  await emit(ctx.db, a.id, "variant_rendered", { variantId: variant.id, status: "rendered" });
  await advanceIfDone(ctx, a);
};
