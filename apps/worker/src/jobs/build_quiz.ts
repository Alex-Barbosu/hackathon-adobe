import { z } from "zod";
import {
  allowedDynamicSlots,
  cleanDirections,
  instantiateCoreQuestions,
  validateDynamicQuestions,
  type BankContext,
  type Element,
  type FindingLite,
  type QuizQuestion,
} from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { adPalette } from "../image/color.ts";
import { decodePng } from "../image/raster.ts";
import { QuotaExhaustedError, SchemaInvalidError } from "../errors.ts";
import * as directionsPrompt from "../llm/prompts/directions.ts";
import * as quizPrompt from "../llm/prompts/quiz_bank.ts";
import { sha256Hex } from "../image/raster.ts";
import { transition } from "../pipeline/state.ts";
import { BUCKETS, download } from "../storage.ts";
import type { Ctx, JobHandler } from "./context.ts";
import {
  NumberRecord,
  getAd,
  getAnalysis,
  getAnalysisRegions,
  getBrands,
  mergeConfig,
  parseJson,
  requireNormalizedPath,
  type Analysis,
} from "./data.ts";

async function paletteOf(ctx: Ctx, adId: string, seed: number, k: number): Promise<string[]> {
  const ad = await getAd(ctx.db, adId);
  const raster = await decodePng(await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad)));
  return (await adPalette(raster, seed, k)).map((p) => p.hex);
}

async function competitorPalettes(ctx: Ctx, a: Analysis): Promise<Record<string, string[]>> {
  const refs = must(await ctx.db.from("analysis_ads").select("ad_id").eq("analysis_id", a.id).eq("role", "competitor"), "refs");
  const ads = must(await ctx.db.from("ads").select("id, brand_id").in("id", refs.map((r) => r.ad_id)), "ads");
  const out: Record<string, string[]> = {};
  for (const ad of ads) {
    const colors = await paletteOf(ctx, ad.id, a.seed % 2147483647, 3);
    out[ad.brand_id] = [...new Set([...(out[ad.brand_id] ?? []), ...colors])].slice(0, 4);
  }
  return out;
}

async function dynamicQuestions(ctx: Ctx, a: Analysis, findings: FindingLite[], coreKeys: string[], startOrder: number): Promise<QuizQuestion[]> {
  const slots = [...allowedDynamicSlots(findings).keys()];
  if (slots.length === 0) return [];
  const brands = await getBrands(ctx.db, a.id);
  const withNames = findings.map((f) => ({ ...f, competitorName: brands.find((b) => b.brandId === f.brandId)?.label ?? null }));
  try {
    const res = await ctx.llm.generateJson({ ...quizPrompt.build(withNames, coreKeys, slots), analysisId: a.id });
    const { questions, dropped } = validateDynamicQuestions(res.data.questions, findings, startOrder);
    for (const d of dropped) ctx.log.warn({ analysisId: a.id }, `dropped dynamic question: ${d}`);
    return questions;
  } catch (err) {
    // The quiz is still useful with core questions only, so a failed bank call must not fail the analysis.
    if (err instanceof SchemaInvalidError || err instanceof QuotaExhaustedError) {
      ctx.log.warn({ analysisId: a.id, err: err.message }, "dynamic questions unavailable; continuing with core questions");
      return [];
    }
    throw err;
  }
}

async function directionPool(ctx: Ctx, a: Analysis, findingsJson: string, impactsJson: string): Promise<Array<{ title: string; description: string; tags: string[] }>> {
  const ad = await getAd(ctx.db, a.target_ad_id);
  const png = await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad));
  try {
    const res = await ctx.llm.generateJson({
      ...directionsPrompt.build(findingsJson, impactsJson, { png, sha256: ad.sha256 ?? sha256Hex(png) }),
      analysisId: a.id,
    });
    const { kept, dropped } = cleanDirections(res.data.directions);
    for (const d of dropped) ctx.log.warn({ analysisId: a.id }, `dropped direction: ${d}`);
    return kept;
  } catch (err) {
    if (err instanceof SchemaInvalidError || err instanceof QuotaExhaustedError) {
      ctx.log.warn({ analysisId: a.id, err: err.message }, "directions unavailable; pairwise rounds will be skipped");
      return [];
    }
    throw err;
  }
}

// 8.2 build_quiz: instantiate core templates from data, add dynamic questions and the direction pool.
export const buildQuiz: JobHandler<"build_quiz"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "diagnosed" && a.status !== "quiz_ready") return;
  const existing = (await ctx.db.from("quiz_sessions").select("id").eq("analysis_id", a.id).maybeSingle()).data;
  if (existing) {
    await transition(ctx.db, a.id, "quiz_ready");
    return;
  }

  const brands = await getBrands(ctx.db, a.id);
  const regions = (await getAnalysisRegions(ctx.db, a.id, a.target_ad_id)).filter((r) => r.approved);
  const impactRows = must(await ctx.db.from("element_impacts").select("element, delta").eq("analysis_id", a.id), "impacts");
  const baseline = must(await ctx.db.from("conditions").select("id").eq("analysis_id", a.id).eq("kind", "baseline").single(), "baseline");
  const bm = must(await ctx.db.from("condition_metrics").select("cue_freq, pull").eq("condition_id", baseline.id).single(), "baseline metrics");
  const pull = parseJson(NumberRecord, bm.pull, "pull");
  const findingRows = must(await ctx.db.from("findings").select("*").eq("analysis_id", a.id), "findings");
  const findings: FindingLite[] = findingRows.map((f) => ({
    findingKey: f.finding_key,
    rule: f.rule,
    element: f.element,
    brandId: f.brand_id,
    severity: f.severity,
    evidence: parseJson(z.record(z.string(), z.unknown()), f.evidence, "evidence"),
  }));

  const palette = await paletteOf(ctx, a.target_ad_id, a.seed % 2147483647, 5);
  const palettes = await competitorPalettes(ctx, a);
  await mergeConfig(ctx.db, a.id, { targetPalette: palette, competitorPalettes: palettes });

  const bankCtx: BankContext = {
    regions: regions.map((r) => ({ id: r.id, kind: r.kind, label: r.label, isIdentifier: r.isIdentifier })),
    impacts: impactRows.map((r) => ({ element: r.element as Element, delta: r.delta })),
    cueShares: parseJson(NumberRecord, bm.cue_freq, "cue_freq"),
    palette,
    competitors: brands.filter((b) => !b.isTarget).map((b) => ({ id: b.brandId, name: b.label, pull: pull[b.brandId] ?? 0 })),
  };
  const core = instantiateCoreQuestions(bankCtx);
  const dynamic = await dynamicQuestions(ctx, a, findings, core.map((q) => q.key), core.length);

  const session = must(await ctx.db.from("quiz_sessions").insert({ analysis_id: a.id, owner_id: a.owner_id }).select("id").single(), "quiz session");
  const questions = [...core, ...dynamic].map((q) => ({
    session_id: session.id,
    key: q.key,
    source: q.source,
    type: q.type,
    prompt: q.prompt,
    help: q.help,
    options: toJson(q.options),
    constraints: toJson(q.constraints),
    fills_slots: q.fillsSlots,
    required: q.required,
    priority: q.priority,
    depends_on: q.dependsOn ? toJson(q.dependsOn) : null,
    finding_key: q.findingKey,
  }));
  mustOk(await ctx.db.from("quiz_questions").insert(questions), "insert questions");

  const directions = await directionPool(ctx, a, JSON.stringify(findings), JSON.stringify(impactRows));
  if (directions.length > 0) {
    mustOk(
      await ctx.db.from("directions").insert(
        directions.map((d) => ({ session_id: session.id, title: d.title, description: d.description, tags: d.tags })),
      ),
      "insert directions",
    );
  }
  await transition(ctx.db, a.id, "quiz_ready");
  await emit(ctx.db, a.id, "quiz_ready", { sessionId: session.id });
};
