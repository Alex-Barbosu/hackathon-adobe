import type { z } from "zod";

// The rest of the codebase only sees this. Swapping providers or call styles touches one file.
export type Task =
  | "detect"
  | "leak_check"
  | "panel"
  | "quiz_bank"
  | "directions"
  | "plan"
  | "plan_repair"
  | "brand_fit"
  | "report";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; png: Uint8Array; sha256: string; label?: string };

export interface JsonRequest<T> {
  task: Task;
  // e.g. "panel@3"; part of the cache key, so bumping it invalidates old answers on purpose.
  promptVersion: string;
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  temperature: number;
  analysisId?: string;
  cacheKeyExtra?: Record<string, string | number>;
}

export interface LlmResult<T> {
  data: T;
  // The model that actually answered (after fallback).
  model: string;
  cacheHit: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface EmbedRequest {
  png: Uint8Array;
  sha256: string;
  analysisId?: string;
}

export interface EmbedResult {
  // L2-normalized.
  vector: number[];
  model: string;
  cacheHit: boolean;
}

export interface LlmClient {
  generateJson<T>(req: JsonRequest<T>): Promise<LlmResult<T>>;
  embedImage(req: EmbedRequest): Promise<EmbedResult>;
}
