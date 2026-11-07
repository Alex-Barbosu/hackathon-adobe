import { GoogleGenAI } from "@google/genai";
import { clampNorm } from "@nologo/core";
import { loadEnv, requiredModels, type Env } from "./env.ts";

async function listAvailableModels(env: Env): Promise<Set<string>> {
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const names = new Set<string>();
  for await (const model of await client.models.list()) {
    if (model.name) names.add(model.name.replace(/^models\//, ""));
  }
  return names;
}

async function dryRun(env: Env): Promise<number> {
  const available = await listAvailableModels(env);
  let missing = 0;
  for (const id of requiredModels(env)) {
    const found = available.has(id);
    if (!found) missing += 1;
    console.log(`${found ? "found  " : "MISSING"} ${id}`);
  }
  console.log(
    `shared core reachable from worker: ${JSON.stringify(clampNorm([-5, 10, 1200, 999]))}`,
  );
  return missing === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile("../../.env");
  } catch {
    // No .env file: rely on the real environment.
  }
  const env = loadEnv(process.env);
  if (process.argv.includes("--dry-run")) {
    process.exitCode = await dryRun(env);
    return;
  }
  throw new Error("Worker loop is implemented in Phase 5; use --dry-run for now.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
