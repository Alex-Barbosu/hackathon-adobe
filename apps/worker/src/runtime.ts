import pino from "pino";
import { createDb } from "./db.ts";
import type { Env } from "./env.ts";
import type { Ctx } from "./jobs/context.ts";
import type { LlmClient } from "./llm/client.ts";
import { GeminiTransport } from "./llm/gemini.ts";
import { RateLimiter } from "./llm/limiter.ts";
import { LlmService } from "./llm/service.ts";
import { SupabaseLlmStore } from "./llm/store.ts";
import { Queue } from "./queue.ts";

export function createLogger(level: string): pino.Logger {
  return pino({ level, redact: ["*.apiKey", "*.GEMINI_API_KEY", "*.SUPABASE_SERVICE_ROLE_KEY"] });
}

// Fail fast on missing quotas: the limiter and the daily budget cannot guess a safe number.
export function requireQuotas(env: Env, models: string[]): void {
  const missing = models.filter((m) => !env.quotas[m]);
  if (missing.length > 0) {
    throw new Error(`Missing quota config for: ${missing.join(", ")} (set QUOTAS_JSON or QUOTA_<model>_RPM/RPD)`);
  }
}

export function createGeminiClient(env: Env, models: string[], db: ReturnType<typeof createDb>): { llm: LlmService; transport: GeminiTransport } {
  requireQuotas(env, models);
  const rpm = Object.fromEntries(models.map((m) => [m, env.quotas[m]?.rpm ?? 1]));
  const rpd = Object.fromEntries(models.map((m) => [m, env.quotas[m]?.rpd ?? 0]));
  const transport = new GeminiTransport(env.GEMINI_API_KEY);
  const llm = new LlmService({
    models: env,
    embedDims: env.EMBED_DIMS,
    rpd,
    safetyMargin: env.QUOTA_SAFETY_MARGIN,
    limiter: new RateLimiter(rpm, env.QUOTA_SAFETY_MARGIN),
    transport,
    store: new SupabaseLlmStore(db),
  });
  return { llm, transport };
}

export function createCtx(env: Env, llm: LlmClient): Ctx {
  const db = createDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return { db, llm, env, log: createLogger(env.LOG_LEVEL), queue: new Queue(db) };
}
