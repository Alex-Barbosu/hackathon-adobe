import { diagnose as runDiagnosis, type ConditionSummary, type Element, type ImpactInput } from "@nologo/core";
import { must, mustOk, toJson } from "../db.ts";
import { emit } from "../events.ts";
import { transition } from "../pipeline/state.ts";
import { idem, type JobHandler } from "./context.ts";
import { NumberPairRecord, NumberRecord, Pair, getAnalysis, parseJson } from "./data.ts";

// 12.5: pure rules on stored numbers. No model call decides anything here.
export const diagnose: JobHandler<"diagnose"> = async (ctx, msg) => {
  const a = await getAnalysis(ctx.db, msg.analysisId);
  if (a.status !== "aggregating") return;
  const conds = must(await ctx.db.from("conditions").select("id, kind").eq("analysis_id", a.id).is("variant_id", null), "conditions");
  const baseline = conds.find((c) => c.kind === "baseline");
  const control = conds.find((c) => c.kind === "control_no_memory");
  if (!baseline) throw new Error("No baseline condition");
  const metrics = must(await ctx.db.from("condition_metrics").select("*").eq("analysis_id", a.id), "metrics");
  const bm = metrics.find((m) => m.condition_id === baseline.id);
  if (!bm) throw new Error("No baseline metrics");
  const cm = control ? metrics.find((m) => m.condition_id === control.id) : undefined;

  const votes = must(await ctx.db.from("panel_votes").select("saw_identifier").eq("condition_id", baseline.id), "votes");
  const leakShare = votes.length === 0 ? 0 : votes.filter((v) => v.saw_identifier).length / votes.length;
  const baseline_: ConditionSummary = {
    nVotes: bm.n_votes,
    nBatches: bm.n_batches,
    attribution: bm.attribution,
    attributionCi: parseJson(Pair, bm.attribution_ci, "attribution_ci"),
    pull: parseJson(NumberRecord, bm.pull, "pull"),
    pullCi: parseJson(NumberPairRecord, bm.pull_ci, "pull_ci"),
    cueFreq: parseJson(NumberRecord, bm.cue_freq, "cue_freq"),
    sawIdentifierShare: leakShare,
  };

  const impactRows = must(await ctx.db.from("element_impacts").select("*").eq("analysis_id", a.id), "impacts");
  const impacts: ImpactInput[] = impactRows.map((r) => ({
    element: r.element,
    delta: r.delta,
    deltaCi: parseJson(Pair, r.delta_ci, "delta_ci"),
    pullShift: parseJson(NumberRecord, r.pull_shift, "pull_shift"),
    pullShiftCi: parseJson(NumberPairRecord, r.pull_shift_ci, "pull_shift_ci"),
  }));
  const sim = (await ctx.db.from("similarity").select("centroid_percentile").eq("analysis_id", a.id).maybeSingle()).data;

  const result = runDiagnosis({
    thresholds: a.cfg.thresholds,
    baseline: baseline_,
    controlAttribution: cm?.attribution ?? null,
    impacts,
    centroidPercentile: sim?.centroid_percentile ?? null,
    leakShare,
  });

  // Findings are keyed by a stable finding_key, so re-running replaces rather than duplicates.
  if (result.findings.length > 0) {
    mustOk(
      await ctx.db.from("findings").upsert(
        result.findings.map((f) => ({
          analysis_id: a.id,
          finding_key: f.findingKey,
          rule: f.rule,
          severity: f.severity,
          element: f.element,
          brand_id: f.brandId,
          evidence: toJson(f.evidence),
        })),
        { onConflict: "analysis_id,finding_key" },
      ),
      "findings",
    );
  }
  for (const [element, label] of Object.entries(result.labels)) {
    mustOk(
      await ctx.db.from("element_impacts").update({ label }).eq("analysis_id", a.id).eq("element", element as Element),
      "impact label",
    );
  }
  await transition(ctx.db, a.id, "diagnosed");
  await emit(ctx.db, a.id, "findings_ready", { count: result.findings.length });
  await ctx.queue.send({ type: "build_quiz", analysisId: a.id, idem: idem("build_quiz", a.id) });
};
