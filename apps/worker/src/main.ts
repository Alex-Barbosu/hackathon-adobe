import { clampNorm } from "@nologo/core";
import { createDb } from "./db.ts";
import { loadEnv, requiredModels } from "./env.ts";
import { createCtx, createGeminiClient } from "./runtime.ts";
import { startWorker } from "./worker.ts";

async function main(): Promise<void> {
  try {
    process.loadEnvFile("../../.env");
  } catch {
    // No .env file: rely on the real environment.
  }
  const env = loadEnv(process.env);
  const models = requiredModels(env);
  const dryRun = process.argv.includes("--dry-run");
  const db = createDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { llm, transport } = createGeminiClient(env, models, db);

  // Verify configured ids exist before accepting work; a missing model would fail every job later.
  const available = new Set(await transport.listModels());
  let missing = 0;
  for (const id of models) {
    const found = available.has(id);
    if (!found) missing += 1;
    console.log(`${found ? "found  " : "MISSING"} ${id}`);
  }
  if (dryRun) {
    console.log(`shared core reachable from worker: ${JSON.stringify(clampNorm([-5, 10, 1200, 999]))}`);
    process.exitCode = missing === 0 ? 0 : 1;
    return;
  }
  if (missing > 0) throw new Error(`Refusing to start: ${missing} configured model(s) not found`);

  const ctx = createCtx(env, llm);
  const handle = startWorker(ctx, { pollMs: env.WORKER_POLL_MS, concurrency: env.WORKER_CONCURRENCY, visibilitySeconds: 180 });
  ctx.log.info({ models }, "worker started");
  const shutdown = (signal: string): void => {
    ctx.log.info({ signal }, "shutting down; finishing in-flight jobs");
    void handle.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", () => { shutdown("SIGINT"); });
  process.once("SIGTERM", () => { shutdown("SIGTERM"); });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
