import { JobMessage, type JobMessageValue, type JobType } from "@nologo/core";
import { aggregate } from "./aggregate.ts";
import { brandFit } from "./brand_fit.ts";
import { buildConditions } from "./build_conditions.ts";
import { buildQuiz } from "./build_quiz.ts";
import type { Ctx } from "./context.ts";
import { detectRegions } from "./detect_regions.ts";
import { diagnose } from "./diagnose.ts";
import { embed } from "./embed.ts";
import { ingestAd } from "./ingest_ad.ts";
import { leakCheck } from "./leak_check.ts";
import { planPanel } from "./plan_panel.ts";
import { planVariants } from "./plan_variants.ts";
import { renderVariant } from "./render_variant.ts";
import { report } from "./report.ts";
import { runPanelBatch } from "./run_panel_batch.ts";
import { startAnalysis } from "./start_analysis.ts";

type Handlers = { [T in JobType]: (ctx: Ctx, msg: Extract<JobMessageValue, { type: T }>) => Promise<void> };

const handlers: Handlers = {
  start_analysis: startAnalysis,
  ingest_ad: ingestAd,
  detect_regions: detectRegions,
  leak_check: leakCheck,
  build_conditions: buildConditions,
  plan_panel: planPanel,
  run_panel_batch: runPanelBatch,
  embed,
  aggregate,
  diagnose,
  build_quiz: buildQuiz,
  plan_variants: planVariants,
  render_variant: renderVariant,
  brand_fit: brandFit,
  report,
};

export function parseJob(raw: unknown): JobMessageValue {
  return JobMessage.parse(raw);
}

// The switch keeps each handler paired with its own message type without a cast.
export async function runJob(ctx: Ctx, msg: JobMessageValue): Promise<void> {
  switch (msg.type) {
    case "start_analysis": return handlers.start_analysis(ctx, msg);
    case "ingest_ad": return handlers.ingest_ad(ctx, msg);
    case "detect_regions": return handlers.detect_regions(ctx, msg);
    case "leak_check": return handlers.leak_check(ctx, msg);
    case "build_conditions": return handlers.build_conditions(ctx, msg);
    case "plan_panel": return handlers.plan_panel(ctx, msg);
    case "run_panel_batch": return handlers.run_panel_batch(ctx, msg);
    case "embed": return handlers.embed(ctx, msg);
    case "aggregate": return handlers.aggregate(ctx, msg);
    case "diagnose": return handlers.diagnose(ctx, msg);
    case "build_quiz": return handlers.build_quiz(ctx, msg);
    case "plan_variants": return handlers.plan_variants(ctx, msg);
    case "render_variant": return handlers.render_variant(ctx, msg);
    case "brand_fit": return handlers.brand_fit(ctx, msg);
    case "report": return handlers.report(ctx, msg);
  }
}

export function analysisIdOf(msg: JobMessageValue): string | null {
  return "analysisId" in msg ? msg.analysisId : null;
}
