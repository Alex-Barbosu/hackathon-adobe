// Debug helper: prints the state of the latest analysis (status, batches, variants, queue depth).
import { createDb } from "../apps/worker/src/db.ts";
import { env } from "./lib.ts";

const e = env(true);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const { data: a } = await db.from("analyses").select("id, status, error, pending_batches").order("created_at", { ascending: false }).limit(1).single();
console.log("analysis", a);
if (a) {
  const b = (await db.from("panel_batches").select("status, error").eq("analysis_id", a.id)).data ?? [];
  const counts: Record<string, number> = {};
  for (const x of b) counts[x.status] = (counts[x.status] ?? 0) + 1;
  console.log("batches", counts, b.filter((x) => x.error).slice(0, 3));
  const v = (await db.from("variants").select("idx, status, change_ratio, rejection_reasons, metrics").eq("analysis_id", a.id).order("idx")).data ?? [];
  console.log("variants", JSON.stringify(v));
  const c = (await db.from("ai_calls").select("task, status, error").eq("analysis_id", a.id).neq("status", "ok").limit(5)).data ?? [];
  console.log("non-ok calls", c);
}
process.exit(0);
