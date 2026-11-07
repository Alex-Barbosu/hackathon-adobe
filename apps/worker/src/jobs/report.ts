import { CreativeBrief } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { QuotaExhaustedError, SchemaInvalidError } from "../errors.ts";
import * as reportPrompt from "../llm/prompts/report.ts";
import {
  checkNumbers,
  direction,
  pct,
  pctRange,
  points,
  templateReport,
  type NumberCheck,
  type ReportData,
} from "../pipeline/reportdata.ts";
import { transition } from "../pipeline/state.ts";
import type { Ctx, JobHandler } from "./context.ts";
import { Pair, getAnalysis, getBrands, parseJson, targetBrandId, type Analysis } from "./data.ts";
import { z } from "zod";

const VariantMetrics = z.object({
  delta: z.number(),
  deltaCi: z.tuple([z.number(), z.number()]),
  winsOnAttribution: z.boolean(),
  similarity: z.object({ centroidSimChange: z.number() }).nullable().optional(),
});
const BrandFit = z.object({
  pass: z.boolean(),
  model: z.object({ tone_match: z.number() }).nullable(),
});

async function assemble(ctx: Ctx, a: Analysis): Promise<ReportData> {
  const brands = await getBrands(ctx.db, a.id);
  const name = (id: string | null): string | null => brands.find((b) => b.brandId === id)?.label ?? null;
  const target = name(targetBrandId(brands)) ?? "the brand";
  const conds = must(await ctx.db.from("conditions").select("id, kind").eq("analysis_id", a.id).is("variant_id", null), "conditions");
  const metrics = must(await ctx.db.from("condition_metrics").select("*").eq("analysis_id", a.id), "metrics");
  const base = metrics.find((m) => m.condition_id === conds.find((c) => c.kind === "baseline")?.id);
  const control = metrics.find((m) => m.condition_id === conds.find((c) => c.kind === "control_no_memory")?.id);
  const impacts = must(await ctx.db.from("element_impacts").select("*").eq("analysis_id", a.id).order("element"), "impacts");
  const findings = must(await ctx.db.from("findings").select("*").eq("analysis_id", a.id).order("severity", { ascending: false }), "findings");
  const sim = (await ctx.db.from("similarity").select("*").eq("analysis_id", a.id).maybeSingle()).data;
  const briefRow = (await ctx.db.from("creative_briefs").select("brief").eq("analysis_id", a.id).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  const brief = briefRow ? parseJson(CreativeBrief, briefRow.brief, "brief") : null;
  const variants = must(await ctx.db.from("variants").select("*").eq("analysis_id", a.id).order("idx"), "variants");
  const directionTitles = brief && brief.topDirectionIds.length > 0
    ? must(await ctx.db.from("directions").select("title").in("id", brief.topDirectionIds), "directions").map((d) => d.title)
    : [];

  const caveats = ["The panel is simulated by an AI model; it is not real people and is a proxy for human viewers."];
  if (a.preset === "free") caveats.push("The free preset uses 2 calls per condition, so intervals are wide and are the wider of two bootstrap methods.");
  if (a.cfg.leakOverride) caveats.push("The mask was force-approved despite a leak warning, so results may be contaminated.");
  if (findings.some((f) => f.rule === "leak")) caveats.push("Some simulated viewers reported seeing a brand identifier, so results may be contaminated.");
  if (findings.some((f) => f.rule === "known_brand")) caveats.push("Recognition without prior exposure was high, so part of it is owed to prior knowledge of the brand.");
  if (a.cfg.skippedElements.length > 0) caveats.push(`These elements were not tested because the ad has none: ${a.cfg.skippedElements.join(", ")}.`);

  return {
    notice: "AI panel, not real people.",
    target: {
      brand: target,
      attribution: pct(base?.attribution ?? 0),
      interval: pctRange(parseJson(Pair, base?.attribution_ci ?? [0, 0], "ci")),
      votes: base?.n_votes ?? 0,
      batches: base?.n_batches ?? 0,
    },
    control: control ? { attribution: pct(control.attribution) } : null,
    elements: impacts.map((i) => ({
      element: i.element,
      label: i.label,
      change: points(i.delta),
      direction: direction(i.delta),
      interval: pctRange(parseJson(Pair, i.delta_ci, "ci")),
    })),
    findings: findings.map((f) => ({
      rule: f.rule,
      element: f.element,
      brand: name(f.brand_id),
      severity: f.severity,
      summary: Object.entries(f.evidence as Record<string, unknown>)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => `${k} ${pct(v as number)}`)
        .join(", "),
    })),
    similarity: sim ? { percentile: pct(sim.centroid_percentile), nearestBrand: name(sim.nearest_brand_id) } : null,
    quiz: brief
      ? {
          changeBudget: brief.changeBudget,
          colorFreedom: brief.colorFreedom,
          competitorToEscape: name(brief.competitorToEscape),
          ownableRanked: brief.ownableAssetsRanked,
          topDirections: directionTitles,
        }
      : null,
    variants: variants.map((v) => {
      const m = v.metrics ? VariantMetrics.safeParse(v.metrics) : null;
      const bf = v.brand_fit ? BrandFit.safeParse(v.brand_fit) : null;
      const metricsOk = m?.success ? m.data : null;
      const fitOk = bf?.success ? bf.data : null;
      return {
        name: `V${v.idx + 1}`,
        title: (v.plan as { title?: string }).title ?? `Variant ${v.idx + 1}`,
        hypothesis: v.hypothesis,
        status: v.status,
        changedPixels: v.change_ratio === null ? null : pct(v.change_ratio),
        attributionChange: metricsOk ? points(metricsOk.delta) : null,
        attributionDirection: metricsOk ? direction(metricsOk.delta) : null,
        interval: metricsOk ? pctRange(metricsOk.deltaCi) : null,
        similarityChange: metricsOk?.similarity ? points(metricsOk.similarity.centroidSimChange) : null,
        brandFit: fitOk ? (fitOk.pass ? "passes" : "does not pass") : "not assessed",
        wins: Boolean(metricsOk?.winsOnAttribution && fitOk?.pass),
      };
    }),
    caveats,
  };
}

async function write(ctx: Ctx, a: Analysis, data: ReportData): Promise<{ markdown: string; model: string; check: NumberCheck; regenerated: boolean }> {
  const json = JSON.stringify(data);
  try {
    let res = await ctx.llm.generateJson({ ...reportPrompt.build(json), analysisId: a.id });
    let check = checkNumbers(res.data.markdown, data);
    let regenerated = false;
    if (check.offending.length > 0) {
      // One regeneration listing the offenders; if it still fails, keep it and surface the warning.
      res = await ctx.llm.generateJson({ ...reportPrompt.build(json, check.offending), analysisId: a.id });
      check = checkNumbers(res.data.markdown, data);
      regenerated = true;
    }
    return { markdown: res.data.markdown, model: res.model, check, regenerated };
  } catch (err) {
    if (!(err instanceof SchemaInvalidError || err instanceof QuotaExhaustedError)) throw err;
    ctx.log.warn({ analysisId: a.id, err: err.message }, "report model unavailable; using the data template");
    const markdown = templateReport(data);
    return { markdown, model: "template", check: checkNumbers(markdown, data), regenerated: false };
  }
}

// 10.9: the model writes prose; every number must come from stored metrics.
export const report: JobHandler<"report"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "reporting" && a.status !== "done") return;
  const data = await assemble(ctx, a);
  const out = await write(ctx, a, data);
  const prev = (await ctx.db.from("reports").select("version").eq("analysis_id", a.id).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  if (a.status === "done" && prev) return;
  mustOk(
    await ctx.db.from("reports").upsert({
      analysis_id: a.id,
      version: (prev?.version ?? 0) + 1,
      model: out.model,
      markdown: out.markdown,
      data: toJson(data),
      number_check: toJson({ offending: out.check.offending, checked: out.check.checked, regenerated: out.regenerated }),
    }),
    "store report",
  );
  await transition(ctx.db, a.id, "done");
  await emit(ctx.db, a.id, "report_ready", {});
};
