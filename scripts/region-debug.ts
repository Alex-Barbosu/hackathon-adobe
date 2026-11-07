// Debug helper: where does a region id live, and what does its analysis look like?
import { createDb } from "../apps/worker/src/db.ts";
import { env, flag } from "./lib.ts";

const e = env(true);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const id = flag("id") ?? "";
const r = (await db.from("regions").select("id, ad_id, analysis_id, kind, approved, source").eq("id", id)).data;
console.log("region", JSON.stringify(r));
const aid = r?.[0]?.analysis_id;
if (aid) {
  const a = (await db.from("analyses").select("id, status, target_ad_id, owner_id").eq("id", aid).single()).data;
  console.log("analysis", JSON.stringify(a));
  const all = (await db.from("regions").select("id, ad_id, kind").eq("analysis_id", aid)).data ?? [];
  console.log("regions in analysis:", all.length, "distinct ads:", [...new Set(all.map((x) => x.ad_id))].length);
}
const latest = (await db.from("analyses").select("id, status, created_at").order("created_at", { ascending: false }).limit(3)).data;
console.log("latest analyses", JSON.stringify(latest));
const l = latest?.[0]?.id;
if (l) {
  const rs = (await db.from("regions").select("id, kind, approved, source, created_at").eq("analysis_id", l).order("created_at")).data ?? [];
  console.log("latest analysis regions:", rs.length, JSON.stringify(rs.map((x) => [x.id.slice(0, 8), x.kind, x.approved, x.source])));
  const ev = (await db.from("analysis_events").select("type, payload").eq("analysis_id", l).order("id")).data ?? [];
  console.log("events:", JSON.stringify(ev.map((x) => x.type)));
  console.log("error:", (await db.from("analyses").select("error").eq("id", l).single()).data?.error);
}
process.exit(0);
