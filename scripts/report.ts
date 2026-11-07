// Writes out/<analysis>/report.md, metrics.json and the variant images. Usage: tsx scripts/report.ts [--analysis <id>]
import { mkdirSync, writeFileSync } from "node:fs";
import { createDb } from "../apps/worker/src/db.ts";
import { BUCKETS, download } from "../apps/worker/src/storage.ts";
import { env, flag } from "./lib.ts";

const e = env(true);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
const id = flag("analysis") ?? (await db.from("analyses").select("id").eq("status", "done").order("created_at", { ascending: false }).limit(1).single()).data?.id;
if (!id) throw new Error("no finished analysis found");
const report = (await db.from("reports").select("*").eq("analysis_id", id).order("version", { ascending: false }).limit(1).single()).data;
if (!report) throw new Error("analysis has no report");
const dir = `out/${id}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/report.md`, report.markdown);
const [metrics, impacts, findings, variants, conds] = await Promise.all([
  db.from("condition_metrics").select("*").eq("analysis_id", id),
  db.from("element_impacts").select("*").eq("analysis_id", id),
  db.from("findings").select("*").eq("analysis_id", id),
  db.from("variants").select("*").eq("analysis_id", id).order("idx"),
  db.from("conditions").select("id, kind, element, image_path").eq("analysis_id", id),
]);
writeFileSync(`${dir}/metrics.json`, JSON.stringify({ numberCheck: report.number_check, reportData: report.data, conditionMetrics: metrics.data, elementImpacts: impacts.data, findings: findings.data, variants: variants.data }, null, 2));
for (const c of conds.data ?? []) {
  writeFileSync(`${dir}/${c.kind}${c.element ? `-${c.element}` : ""}-${c.id.slice(0, 6)}.png`, await download(db, BUCKETS.derived, c.image_path));
}
for (const v of variants.data ?? []) {
  if (v.original_render_path) writeFileSync(`${dir}/variant-${v.idx + 1}-unmasked.png`, await download(db, BUCKETS.derived, v.original_render_path));
}
console.log(`wrote ${dir}/ (report.md, metrics.json, images)`);
process.exit(0);
