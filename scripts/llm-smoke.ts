// Phase 4 manual check: three real Gemini calls (detect, one panel batch, one embedding).
import { createDb } from "../apps/worker/src/db.ts";
import { requiredModels } from "../apps/worker/src/env.ts";
import { createGeminiClient } from "../apps/worker/src/runtime.ts";
import * as detect from "../apps/worker/src/llm/prompts/detect.ts";
import * as panel from "../apps/worker/src/llm/prompts/panel.ts";
import { sha256Hex } from "../apps/worker/src/image/raster.ts";
import { syntheticAd } from "../apps/worker/src/image/synthetic.ts";
import { env } from "./lib.ts";

const e = env(false);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const { llm } = createGeminiClient(e, requiredModels(e), db);
const ad = syntheticAd({ size: 384, background: [240, 230, 200], border: [20, 60, 120], logo: [200, 30, 30], mascot: [250, 200, 0], product: [30, 140, 60], text: [40, 40, 40] });
const png = await ad.png();
const img = { png, sha256: sha256Hex(png) };

console.log("detect:", JSON.stringify((await llm.generateJson(detect.build(img))).data));
const built = panel.build({
  personas: [{ id: "heavy_weekly", description: "Buys weekly", viewing_mode: "considered", category_familiarity: "heavy" }],
  candidates: [{ id: "a", label: "Sunny" }, { id: "b", label: "Zest" }],
  exposures: [],
  test: img,
});
console.log("panel:", JSON.stringify((await llm.generateJson(built.request)).data));
console.log("embedding dims:", (await llm.embedImage(img)).vector.length);
const { data } = await db.from("ai_calls").select("task, model, status, cache_hit, latency_ms").order("created_at", { ascending: false }).limit(6);
console.table(data);
process.exit(0);
