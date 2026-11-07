import { clampNorm } from "@nologo/core";
import { mustOk } from "../db.ts";
import { emit } from "../events.ts";
import { encodePng, decodePng, sha256Hex } from "../image/raster.ts";
import { maskRaster } from "../image/mask.ts";
import * as leak from "../llm/prompts/leak_check.ts";
import { idem, type JobHandler } from "./context.ts";
import { BUCKETS, download } from "../storage.ts";
import { transition } from "../pipeline/state.ts";
import { getAd, getAnalysis, getAnalysisRegions, requireNormalizedPath } from "./data.ts";

const KIND_FOR_LEAK = {
  logo: "logo",
  brand_name: "brand_name",
  packaging_text: "packaging_text",
  url_or_handle: "url_or_handle",
  other_identifier: "brand_name",
} as const;

// 8.2: mask with the approved identifiers, then ask whether anything identifying is still visible.
// Advisory: a force-approve sets config.leakOverride and skips straight on.
export const leakCheck: JobHandler<"leak_check"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "masking") return;
  const next = (): Promise<void> =>
    ctx.queue.send({ type: "build_conditions", analysisId: a.id, idem: idem("build_conditions", a.id) });
  if (a.cfg.leakOverride) {
    await next();
    return;
  }
  const ad = await getAd(ctx.db, a.target_ad_id);
  const png = await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad));
  const regions = (await getAnalysisRegions(ctx.db, a.id, ad.id)).filter((r) => r.approved && r.isIdentifier);
  const masked = maskRaster(await decodePng(png), regions.map((r) => r.box));
  const maskedPng = await encodePng(masked.raster);
  const res = await ctx.llm.generateJson({ ...leak.build({ png: maskedPng, sha256: sha256Hex(maskedPng) }), analysisId: a.id });
  const leaks = res.data.leaks.filter((l) => l.confidence >= 0.5);
  if (leaks.length === 0) {
    await next();
    return;
  }
  // Propose the missed identifiers as unapproved boxes and hand control back to the reviewer.
  mustOk(
    await ctx.db.from("regions").insert(
      leaks.map((l) => ({
        ad_id: ad.id,
        analysis_id: a.id,
        kind: KIND_FOR_LEAK[l.kind],
        box: [...clampNorm(l.box_2d)],
        label: `leak: ${l.description}`.slice(0, 80),
        confidence: l.confidence,
        source: "model" as const,
        approved: false,
      })),
    ),
    "insert leak regions",
  );
  if (await transition(ctx.db, a.id, "needs_review", ["masking"])) {
    await emit(ctx.db, a.id, "leak_detected", { leaks: leaks.map((l) => ({ kind: l.kind, description: l.description })) });
  }
};
