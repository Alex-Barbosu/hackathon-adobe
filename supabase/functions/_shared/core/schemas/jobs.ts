import { z } from "zod";

// Every message carries an idempotency key so a redelivered message is harmless.
export const JobMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ingest_ad"), adId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("detect_regions"), analysisId: z.uuid(), adId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("leak_check"), analysisId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("build_conditions"), analysisId: z.uuid(), idem: z.string() }),
  z.object({
    type: z.literal("plan_panel"),
    analysisId: z.uuid(),
    conditionIds: z.array(z.uuid()),
    idem: z.string(),
  }),
  z.object({ type: z.literal("run_panel_batch"), analysisId: z.uuid(), batchId: z.uuid(), idem: z.string() }),
  z.object({
    type: z.literal("embed"),
    analysisId: z.uuid(),
    subjectType: z.enum(["ad_masked", "condition"]),
    subjectId: z.uuid(),
    idem: z.string(),
  }),
  z.object({
    type: z.literal("aggregate"),
    analysisId: z.uuid(),
    phase: z.enum(["initial", "retest"]),
    idem: z.string(),
  }),
  z.object({ type: z.literal("diagnose"), analysisId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("build_quiz"), analysisId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("plan_variants"), analysisId: z.uuid(), briefId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("render_variant"), analysisId: z.uuid(), variantId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("brand_fit"), analysisId: z.uuid(), idem: z.string() }),
  z.object({ type: z.literal("report"), analysisId: z.uuid(), idem: z.string() }),
]);
export type JobMessageValue = z.infer<typeof JobMessage>;
export type JobType = JobMessageValue["type"];

export const QUEUES = { high: "jobs_high", bulk: "jobs_bulk" } as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Interactive jobs go first; panel batches and embeddings are bulk.
export function queueFor(type: JobType): QueueName {
  return type === "run_panel_batch" || type === "embed" ? QUEUES.bulk : QUEUES.high;
}
