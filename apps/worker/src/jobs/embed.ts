import { must, mustOk } from "../db.ts";
import { sha256Hex } from "../image/raster.ts";
import { BUCKETS, download, paths } from "../storage.ts";
import type { JobHandler } from "./context.ts";
import { getAd, requireNormalizedPath } from "./data.ts";

// 8.2 embed: embed the masked image (never the original: brand marks would dominate similarity).
export const embed: JobHandler<"embed"> = async (ctx, msg) => {
  let path: string;
  if (msg.subjectType === "ad_masked") {
    const ad = await getAd(ctx.db, msg.subjectId);
    requireNormalizedPath(ad);
    path = paths.maskedAd(ad.owner_id, ad.id);
  } else {
    path = must(await ctx.db.from("conditions").select("image_path").eq("id", msg.subjectId).single(), "condition").image_path;
  }
  const model = ctx.env.MODEL_EMBED;
  const existing = must(
    await ctx.db.from("embeddings").select("id").eq("subject_type", msg.subjectType).eq("subject_id", msg.subjectId).eq("model", model),
    "embeddings",
  );
  if (existing.length > 0) return;
  const png = await download(ctx.db, BUCKETS.derived, path);
  const sha = sha256Hex(png);
  const res = await ctx.llm.embedImage({ png, sha256: sha, analysisId: msg.analysisId });
  mustOk(
    await ctx.db.from("embeddings").upsert(
      {
        subject_type: msg.subjectType,
        subject_id: msg.subjectId,
        model,
        dims: res.vector.length,
        image_sha256: sha,
        // pgvector accepts the text form "[x,y,...]".
        embedding: JSON.stringify(res.vector),
      },
      { onConflict: "subject_type,subject_id,model" },
    ),
    "upsert embedding",
  );
};
