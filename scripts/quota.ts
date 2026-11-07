import { api, env, session } from "./lib.ts";
import { createDb } from "../apps/worker/src/db.ts";

const e = env(true);
const s = await session();
const q = await api<{ day: string; models: Array<{ model: string; used: number; last429: string | null }> }>(s, "GET", "/quota");
console.log(`Pacific day ${q.day}`);
for (const m of q.models) {
  console.log(`${m.model}: used ${m.used} / ${e.quotas[m.model]?.rpd ?? "?"}${m.last429 ? ` (last 429 ${m.last429})` : ""}`);
}
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const since = new Date(Date.now() - 864e5).toISOString();
const calls = (await db.from("ai_calls").select("cache_hit, status").gte("created_at", since)).data ?? [];
const hits = calls.filter((c) => c.cache_hit).length;
console.log(`last 24h: ${calls.length} logged calls, cache hit rate ${calls.length ? Math.round((hits / calls.length) * 100) : 0}%`);
process.exit(0);
