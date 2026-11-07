import { createCtx, createGeminiClient } from "../apps/worker/src/runtime.ts";
import { createDb } from "../apps/worker/src/db.ts";
import { requiredModels } from "../apps/worker/src/env.ts";
import type { Env } from "../apps/worker/src/env.ts";
import type { LlmClient } from "../apps/worker/src/llm/client.ts";
import { SimulatedLlm } from "../apps/worker/src/llm/simulated.ts";
import { startWorker, type WorkerHandle } from "../apps/worker/src/worker.ts";

// Runs the worker inside the script so a demo needs one process. Simulated mode never calls Gemini.
export function localWorker(e: Env, simulated: boolean): { handle: WorkerHandle; ctx: ReturnType<typeof createCtx> } {
  let llm: LlmClient;
  if (simulated) llm = new SimulatedLlm({ oracle: () => undefined, dims: e.EMBED_DIMS });
  else llm = createGeminiClient(e, requiredModels(e), createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY)).llm;
  const ctx = createCtx(e, llm);
  return { ctx, handle: startWorker(ctx, { pollMs: 500, concurrency: e.WORKER_CONCURRENCY, visibilitySeconds: 180 }) };
}
