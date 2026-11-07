import { CreativeBrief, planSignature, validatePlan, type EditPlanValue, type PlanContext } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { FatalError } from "../errors.ts";
import { sha256Hex } from "../image/raster.ts";
import * as planPrompt from "../llm/prompts/plan.ts";
import { buildRefs, regionsTable } from "../pipeline/regionrefs.ts";
import { transition } from "../pipeline/state.ts";
import { BUCKETS, download } from "../storage.ts";
import { idem, type Ctx, type JobHandler } from "./context.ts";
import { getAd, getAnalysis, getAnalysisRegions, parseJson, requireNormalizedPath, type Analysis } from "./data.ts";

const pct = (x: number): string => `${Math.round(x * 100)}%`;

async function metricsSummary(ctx: Ctx, a: Analysis): Promise<string> {
  const conds = must(await ctx.db.from("conditions").select("id, kind, element").eq("analysis_id", a.id).is("variant_id", null), "conditions");
  const metrics = must(await ctx.db.from("condition_metrics").select("*").eq("analysis_id", a.id), "metrics");
  const impacts = must(await ctx.db.from("element_impacts").select("element, delta, label").eq("analysis_id", a.id), "impacts");
  const base = metrics.find((m) => m.condition_id === conds.find((c) => c.kind === "baseline")?.id);
  const lines = [`Baseline attribution to the target brand: ${pct(base?.attribution ?? 0)}`];
  for (const i of impacts) lines.push(`Removing ${i.element} changes attribution by ${pct(i.delta)} (${i.label})`);
  const sim = (await ctx.db.from("similarity").select("centroid_percentile").eq("analysis_id", a.id).maybeSingle()).data;
  if (sim) lines.push(`Similarity to the category centroid: percentile ${pct(sim.centroid_percentile)}`);
  return lines.join("\n");
}

function check(plans: readonly EditPlanValue[], pctx: PlanContext): string[][] {
  return plans.map((p) => validatePlan(p, pctx));
}

// 8.2 plan_variants: the model plans, pure code validates, one repair round, diversity filter.
export const planVariants: JobHandler<"plan_variants"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "planning" && a.status !== "rendering") return;
  const existing = must(await ctx.db.from("variants").select("id, status").eq("analysis_id", a.id), "variants");
  if (existing.length > 0) {
    for (const v of existing.filter((x) => x.status === "planned")) {
      await ctx.queue.send({ type: "render_variant", analysisId: a.id, variantId: v.id, idem: idem("render_variant", v.id) });
    }
    return;
  }
  const briefRow = must(await ctx.db.from("creative_briefs").select("*").eq("id", msg.briefId).single(), "brief");
  const brief = parseJson(CreativeBrief, briefRow.brief, "creative brief");

  const regions = await getAnalysisRegions(ctx.db, a.id, a.target_ad_id);
  const refs = buildRefs(regions, brief.lockedRegionIds);
  const labels = new Map(regions.map((r) => [r.id, r.label]));
  const ad = await getAd(ctx.db, a.target_ad_id);
  const original = await download(ctx.db, BUCKETS.derived, requireNormalizedPath(ad));
  const baseline = must(await ctx.db.from("conditions").select("image_path, image_sha256").eq("analysis_id", a.id).eq("kind", "baseline").single(), "baseline");
  const masked = await download(ctx.db, BUCKETS.derived, baseline.image_path);
  const findings = must(await ctx.db.from("findings").select("finding_key, rule, element, brand_id, severity, evidence").eq("analysis_id", a.id), "findings");

  const planInput: planPrompt.PlanInput = {
    original: { png: original, sha256: ad.sha256 ?? sha256Hex(original) },
    masked: { png: masked, sha256: baseline.image_sha256 },
    regionsTable: regionsTable(refs, labels),
    metricsSummary: await metricsSummary(ctx, a),
    findingsJson: JSON.stringify(findings),
    briefJson: JSON.stringify(brief),
    allowedPalette: brief.palette,
  };
  const pctx: PlanContext = {
    regions: refs,
    brief,
    escapeColors: brief.competitorToEscape ? a.cfg.competitorPalettes[brief.competitorToEscape] ?? [] : [],
  };

  let plans = (await ctx.llm.generateJson({ ...planPrompt.build(planInput), analysisId: a.id })).data.plans;
  let violations = check(plans, pctx);
  if (violations.some((v) => v.length > 0)) {
    // One repair round with the exact violations, verbatim from the validator.
    const flat = violations.flatMap((v, i) => v.map((x) => `plan ${i + 1}: ${x}`));
    plans = (await ctx.llm.generateJson({ ...planPrompt.buildRepair(planInput, flat), analysisId: a.id })).data.plans;
    violations = check(plans, pctx);
  }

  const seen = new Set<string>();
  const rows = plans.map((plan, idx) => {
    const reasons = [...(violations[idx] ?? [])];
    const sig = planSignature(plan);
    if (reasons.length === 0 && seen.has(sig)) reasons.push("duplicate of an earlier plan (same operations on the same regions)");
    if (reasons.length === 0) seen.add(sig);
    return {
      analysis_id: a.id,
      brief_id: briefRow.id,
      idx,
      plan: toJson(plan),
      hypothesis: plan.hypothesis,
      target_element: plan.primaryElement,
      status: reasons.length === 0 ? ("planned" as const) : ("rejected" as const),
      rejection_reasons: reasons.length === 0 ? null : toJson(reasons),
    };
  });
  const inserted = must(
    await ctx.db.from("variants").upsert(rows, { onConflict: "analysis_id,idx" }).select("id, status"),
    "insert variants",
  );
  const accepted = inserted.filter((v) => v.status === "planned");
  if (accepted.length === 0) throw new FatalError("No valid edit plans after repair; see variants.rejection_reasons");
  await transition(ctx.db, a.id, "rendering");
  for (const v of accepted) {
    await ctx.queue.send({ type: "render_variant", analysisId: a.id, variantId: v.id, idem: idem("render_variant", v.id) });
  }
};
