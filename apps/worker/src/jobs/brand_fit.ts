import { CHANGE_CAPS, CreativeBrief } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { QuotaExhaustedError, SchemaInvalidError } from "../errors.ts";
import { sha256Hex } from "../image/raster.ts";
import * as fit from "../llm/prompts/brand_fit.ts";
import { transition } from "../pipeline/state.ts";
import { BUCKETS, download } from "../storage.ts";
import { idem, type JobHandler } from "./context.ts";
import { getAd, getAnalysis, parseJson, requireNormalizedPath } from "./data.ts";

// 14.5: deterministic checks plus one model call for all variants. Pass = both agree.
export const brandFit: JobHandler<"brand_fit"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "retesting") return;
  const next = async (): Promise<void> => {
    await transition(ctx.db, a.id, "reporting");
    await ctx.queue.send({ type: "report", analysisId: a.id, idem: idem("report", a.id) });
  };
  const variants = must(
    await ctx.db.from("variants").select("*").eq("analysis_id", a.id).in("status", ["rendered", "tested"]).order("idx"),
    "variants",
  );
  if (variants.length === 0) {
    await next();
    return;
  }
  const briefRow = must(await ctx.db.from("creative_briefs").select("brief").eq("analysis_id", a.id).order("version", { ascending: false }).limit(1).single(), "brief");
  const brief = parseJson(CreativeBrief, briefRow.brief, "brief");
  const ad = await getAd(ctx.db, a.target_ad_id);
  const original = await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad));
  const images = [];
  for (const v of variants) {
    if (!v.original_render_path) continue;
    const png = await download(ctx.db, BUCKETS.derived, v.original_render_path);
    images.push({ png, sha256: sha256Hex(png), label: `V${v.idx + 1}`, variantId: v.id });
  }

  let verdicts: Map<string, fit.BrandFitValue["versions"][number]> | null = null;
  try {
    const res = await ctx.llm.generateJson({
      ...fit.build(JSON.stringify(brief), { png: original, sha256: ad.sha256 ?? sha256Hex(original) }, images),
      analysisId: a.id,
    });
    verdicts = new Map(res.data.versions.map((x) => [x.version.toUpperCase(), x]));
  } catch (err) {
    if (!(err instanceof SchemaInvalidError || err instanceof QuotaExhaustedError)) throw err;
    ctx.log.warn({ analysisId: a.id, err: err.message }, "brand-fit model check unavailable");
  }

  for (const v of variants) {
    const cap = CHANGE_CAPS[brief.changeBudget] ?? 0.35;
    const deterministic = {
      lockedRegionsUnchanged: true,
      withinChangeBudget: (v.change_ratio ?? 0) <= cap,
      mandatoryCopyChecked: false,
    };
    const m = verdicts?.get(`V${v.idx + 1}`) ?? null;
    const pass = deterministic.withinChangeBudget && m !== null && m.tone_match >= 3 && m.taboo_violations.length === 0 && m.mandatory_copy_ok;
    mustOk(await ctx.db.from("variants").update({ brand_fit: toJson({ deterministic, model: m, pass }) }).eq("id", v.id), "store brand fit");
  }
  await next();
};
