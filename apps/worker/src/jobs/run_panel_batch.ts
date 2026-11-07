import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { FatalError, QuotaExhaustedError, SchemaInvalidError, errorMessage } from "../errors.ts";
import { downscalePng } from "../image/normalize.ts";
import { sha256Hex } from "../image/raster.ts";
import * as panel from "../llm/prompts/panel.ts";
import { EXPOSURE_LONG_SIDE, parsePanelPeople } from "@nologo/core";
import { BUCKETS, download } from "../storage.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import { getAds, getAnalysis, getBrands, requireNormalizedPath, type Row } from "./data.ts";

async function finish(ctx: Ctx, batch: Row<"panel_batches">, status: "done" | "failed", error?: string): Promise<void> {
  mustOk(
    await ctx.db.from("panel_batches").update({ status, error: error ?? null }).eq("id", batch.id),
    "update batch",
  );
  const { data, error: rpcErr } = await ctx.db.rpc("finish_batch", { p_batch_id: batch.id });
  if (rpcErr) throw new Error(`finish_batch: ${rpcErr.message}`);
  const all = must(await ctx.db.from("panel_batches").select("status").eq("condition_id", batch.condition_id), "batches");
  await emit(ctx.db, batch.analysis_id, "batch_done", {
    conditionId: batch.condition_id,
    done: all.filter((b) => b.status === "done" || b.status === "failed").length,
    total: all.length,
  });
  if ((data ?? 1) === 0) {
    const a = await getAnalysis(ctx.db, batch.analysis_id);
    const phase = a.status === "retesting" ? "retest" : "initial";
    await ctx.queue.send({ type: "aggregate", analysisId: a.id, phase, idem: idem("aggregate", a.id, phase, "0") });
  }
}

export const runPanelBatch: JobHandler<"run_panel_batch"> = async (ctx, msg) => {
  const batch = must(await ctx.db.from("panel_batches").select("*").eq("id", msg.batchId).single(), "batch");
  if (batch.finished_at !== null) return;
  const brands = await getBrands(ctx.db, batch.analysis_id);
  const labelOf = new Map(brands.map((b) => [b.brandId, b.label]));
  const cond = must(await ctx.db.from("conditions").select("*").eq("id", batch.condition_id).single(), "condition");
  const personaRows = must(await ctx.db.from("personas").select("*").in("id", batch.persona_ids), "personas");
  const personas = batch.persona_ids.map((id) => {
    const p = personaRows.find((r) => r.id === id);
    if (!p) throw new FatalError(`Unknown persona ${id}`);
    return { id: p.id, description: p.description, viewing_mode: p.viewing_mode, category_familiarity: p.category_familiarity };
  });
  mustOk(await ctx.db.from("panel_batches").update({ status: "running", attempts: batch.attempts + 1 }).eq("id", batch.id), "mark running");

  const testPng = await download(ctx.db, BUCKETS.derived, cond.image_path);
  const exposureAds = await getAds(ctx.db, batch.exposure_ad_ids);
  const exposures = [];
  for (const id of batch.exposure_ad_ids) {
    const ad = exposureAds.find((x) => x.id === id);
    if (!ad) continue;
    const png = await downscalePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad)), EXPOSURE_LONG_SIDE);
    exposures.push({ png, sha256: sha256Hex(png), brandLabel: labelOf.get(ad.brand_id) ?? "unknown" });
  }
  const built = panel.build({
    personas,
    candidates: batch.candidate_order.map((id) => ({ id, label: labelOf.get(id) ?? "unknown" })),
    exposures,
    test: { png: testPng, sha256: cond.image_sha256 },
  });

  let res;
  try {
    res = await ctx.llm.generateJson({ ...built.request, analysisId: batch.analysis_id });
  } catch (err) {
    // The panel never falls back and bad output is not retried forever: count it as a missing batch.
    if (err instanceof SchemaInvalidError) {
      ctx.log.warn({ batchId: batch.id }, "panel output invalid after repair; batch counted as missing");
      await finish(ctx, batch, "failed", errorMessage(err));
      return;
    }
    if (err instanceof QuotaExhaustedError) await emit(ctx.db, batch.analysis_id, "quota_exhausted", { model: err.model });
    throw err;
  }
  const parsed = parsePanelPeople(res.data.people, built.personaByLabel, built.letterToKey);
  if (parsed.votes.length === 0) {
    await finish(ctx, batch, "failed", `no usable votes: ${parsed.dropped.map((d) => d.reason).join("; ")}`);
    return;
  }
  mustOk(
    await ctx.db.from("panel_votes").upsert(
      parsed.votes.map((v) => ({
        batch_id: batch.id,
        condition_id: batch.condition_id,
        persona_id: v.personaId,
        probabilities: toJson(v.probabilities),
        raw_probabilities: toJson(v.raw),
        cues: toJson(v.cues),
        saw_identifier: v.sawIdentifier,
      })),
      { onConflict: "batch_id,persona_id" },
    ),
    "upsert votes",
  );
  mustOk(
    await ctx.db
      .from("panel_batches")
      .update({
        raw_response: toJson(res.data),
        leak_flags: parsed.votes.filter((v) => v.sawIdentifier).length,
      })
      .eq("id", batch.id),
    "store raw response",
  );
  const note = parsed.dropped.length + parsed.missing.length > 0
    ? `partial: dropped ${parsed.dropped.length}, missing ${parsed.missing.length}`
    : undefined;
  await finish(ctx, batch, "done", note);
};
