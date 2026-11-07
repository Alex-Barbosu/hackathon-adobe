import { z } from "zod";
import { REGION_KINDS } from "../config.ts";

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);

export const CreateBrandBody = z.object({ slug: Slug, name: z.string().min(1).max(80), category: z.string().min(1).max(80) });

export const UploadUrlBody = z.object({
  brandId: z.uuid(),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

export const CreateAnalysisBody = z.object({
  targetAdId: z.uuid(),
  competitorBrandIds: z.array(z.uuid()).min(2).max(5),
  exposureAdIds: z.array(z.uuid()).optional(),
  preset: z.enum(["free", "strict"]).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
});

export const RegionEdit = z.object({
  id: z.uuid().optional(),
  kind: z.enum(REGION_KINDS),
  box: z.array(z.number().int().min(0).max(1000)).length(4),
  label: z.string().max(80).optional(),
  approved: z.boolean(),
});
export const PutRegionsBody = z.object({ regions: z.array(RegionEdit).max(80) });

export const ApproveBody = z.object({ force: z.boolean().optional() });

export const StartQuizBody = z.object({ analysisId: z.uuid() });
export const AnswerBody = z.object({ questionId: z.string().min(1), value: z.unknown() });
export const RecommendedBody = z.object({ questionId: z.string().min(1) });
export const PairwiseBody = z.object({ roundId: z.uuid(), choice: z.enum(["a", "b", "neither"]) });

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
