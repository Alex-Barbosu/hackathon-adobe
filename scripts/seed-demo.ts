// Creates the synthetic demo category: brands, ads (uploaded via the real API), ingest, and pre-approved
// ad-level regions (so competitor and exposure ads need no model call). Safe to re-run.
import { adsFor, CATEGORY, DEMO_BRANDS } from "./demo.ts";
import { api, env, session, sleep } from "./lib.ts";
import { localWorker } from "./runner.ts";

const ADS_PER_BRAND = 4;

const e = env(true);
const s = await session();
const { handle, ctx } = localWorker(e, true);
const db = ctx.db;

const created: Array<{ adId: string; regions: ReturnType<typeof adsFor>[number]["regions"] }> = [];
for (const brand of DEMO_BRANDS) {
  let brandId: string;
  try {
    brandId = (await api<{ id: string }>(s, "POST", "/brands", { slug: brand.slug, name: brand.name, category: CATEGORY })).id;
  } catch {
    const { data } = await db.from("brands").select("id").eq("owner_id", s.uid).eq("slug", brand.slug).single();
    if (!data) throw new Error(`brand ${brand.slug} missing`);
    brandId = data.id;
  }
  const have = (await db.from("ads").select("id").eq("brand_id", brandId)).data?.length ?? 0;
  for (const [i, ad] of adsFor(brand, ADS_PER_BRAND).entries()) {
    if (i < have) continue;
    const up = await api<{ adId: string; path: string; token: string }>(s, "POST", "/ads/upload-url", { brandId, contentType: "image/png" });
    const { error } = await s.sb.storage.from("ads-original").uploadToSignedUrl(up.path, up.token, await ad.png(), { contentType: "image/png" });
    if (error) throw new Error(`upload failed: ${error.message}`);
    await api(s, "POST", `/ads/${up.adId}/ingest`);
    created.push({ adId: up.adId, regions: ad.regions });
    console.log(`uploaded ${brand.slug} #${i + 1}`);
  }
}

for (let tries = 0; tries < 120; tries++) {
  const { data } = await db.from("ads").select("id, status").eq("owner_id", s.uid);
  if ((data ?? []).every((a) => a.status === "normalized")) break;
  await sleep(2000);
}
for (const { adId, regions } of created) {
  const { error } = await db.from("regions").insert(
    regions.map((r) => ({ ad_id: adId, analysis_id: null, kind: r.kind, box: [...r.box], label: r.label, confidence: 1, source: "manual" as const, approved: true })),
  );
  if (error) throw new Error(error.message);
}
console.log(`Seeded ${DEMO_BRANDS.length} brands. Pre-approved regions come from the synthetic generator.`);
await handle.stop();
process.exit(0);
