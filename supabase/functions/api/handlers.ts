import {
  ApproveBody,
  CreateAnalysisBody,
  CreateBrandBody,
  PutRegionsBody,
  UploadUrlBody,
  clampNorm,
  resolveConfig,
} from "../_shared/core/index.ts";
import { enqueue, owned, signUrl, transition, type Auth } from "./auth.ts";
import { ApiError, json, readBody } from "./http.ts";

type Row = Record<string, unknown>;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

export async function createBrand(req: Request, { uid, admin }: Auth): Promise<Response> {
  const body = await readBody(req, CreateBrandBody);
  const { data, error } = await admin.from("brands").insert({ ...body, owner_id: uid }).select().single();
  if (error?.code === "23505") throw new ApiError(409, "conflict", "A brand with this slug already exists");
  return json(check({ data, error }, "insert brand"), 201);
}

export async function uploadUrl(req: Request, { uid, admin }: Auth): Promise<Response> {
  const body = await readBody(req, UploadUrlBody);
  await owned(admin, "brands", body.brandId, uid);
  const adId = crypto.randomUUID();
  const ext = body.contentType === "image/png" ? "png" : body.contentType === "image/jpeg" ? "jpg" : "webp";
  // Ids only: the uploaded filename is never stored anywhere the model can see.
  const path = `${uid}/${adId}.${ext}`;
  const signed = await admin.storage.from("ads-original").createSignedUploadUrl(path);
  if (signed.error) throw new Error(`signed upload: ${signed.error.message}`);
  check(
    await admin.from("ads").insert({ id: adId, owner_id: uid, brand_id: body.brandId, original_path: path }),
    "insert ad",
  );
  return json({ adId, uploadUrl: signed.data.signedUrl, token: signed.data.token, path }, 201);
}

export async function ingestAd(adId: string, { uid, admin }: Auth): Promise<Response> {
  await owned(admin, "ads", adId, uid);
  await enqueue(admin, { type: "ingest_ad", adId, idem: `ingest_ad:${adId}` });
  return json({ queued: true });
}

async function normalizedAds(admin: Auth["admin"], brandId: string): Promise<Row[]> {
  return check(
    await admin.from("ads").select("*").eq("brand_id", brandId).eq("status", "normalized").order("created_at"),
    "ads",
  ) as Row[];
}

export async function createAnalysis(req: Request, { uid, admin }: Auth): Promise<Response> {
  const body = await readBody(req, CreateAnalysisBody);
  const target = await owned<Row>(admin, "ads", body.targetAdId, uid);
  const targetBrand = await owned<Row>(admin, "brands", target["brand_id"] as string, uid);
  const unique = [...new Set(body.competitorBrandIds)];
  if (unique.length < 2 || unique.length > 5 || unique.includes(targetBrand["id"] as string)) {
    throw new ApiError(422, "invalid_competitors", "Choose 2-5 competitor brands, not including the target brand");
  }
  const competitors: Row[] = [];
  const competitorAds: string[] = [];
  const exposure = new Set<string>();
  for (const id of unique) {
    const b = await owned<Row>(admin, "brands", id, uid);
    if (b["category"] !== targetBrand["category"]) {
      throw new ApiError(422, "category_mismatch", `${b["name"] as string} is not in category ${targetBrand["category"] as string}`);
    }
    const ads = await normalizedAds(admin, id);
    if (ads.length < 3) {
      throw new ApiError(422, "not_enough_ads", `${b["name"] as string} needs at least 3 normalized ads (has ${ads.length})`);
    }
    competitors.push(b);
    // Reference ads feed similarity; two per brand keeps embedding cost low.
    competitorAds.push(...ads.slice(0, 2).map((a) => a["id"] as string));
    for (const a of ads) exposure.add(a["id"] as string);
  }
  const own = (await normalizedAds(admin, targetBrand["id"] as string)).filter((a) => a["id"] !== target["id"]);
  if (own.length < 2) {
    throw new ApiError(422, "not_enough_ads", `${targetBrand["name"] as string} needs at least 2 other normalized ads so the panel can learn it`);
  }
  for (const a of own) exposure.add(a["id"] as string);
  const exposureIds = body.exposureAdIds ? body.exposureAdIds.filter((id) => exposure.has(id)) : [...exposure];

  const preset = body.preset ?? "free";
  const analysis = check(
    await admin
      .from("analyses")
      .insert({
        owner_id: uid,
        category: targetBrand["category"],
        target_ad_id: target["id"],
        target_brand_id: targetBrand["id"],
        preset,
        config: resolveConfig(preset),
        ...(body.seed !== undefined ? { seed: body.seed } : {}),
      })
      .select()
      .single(),
    "insert analysis",
  ) as Row;
  const id = analysis["id"] as string;
  check(
    await admin.from("analysis_brands").insert([
      { analysis_id: id, brand_id: targetBrand["id"], is_target: true, candidate_label: targetBrand["name"] },
      ...competitors.map((b) => ({ analysis_id: id, brand_id: b["id"], is_target: false, candidate_label: b["name"] })),
    ]),
    "analysis_brands",
  );
  check(
    await admin.from("analysis_ads").insert([
      { analysis_id: id, ad_id: target["id"], role: "target" },
      ...competitorAds.map((ad_id) => ({ analysis_id: id, ad_id, role: "competitor" })),
      ...exposureIds.map((ad_id) => ({ analysis_id: id, ad_id, role: "exposure" })),
    ]),
    "analysis_ads",
  );
  await enqueue(admin, { type: "start_analysis", analysisId: id, idem: `start_analysis:${id}` });
  return json(analysis, 201);
}

export async function getAnalysis(id: string, { uid, admin }: Auth): Promise<Response> {
  const analysis = await owned<Row>(admin, "analyses", id, uid);
  const events = check(
    await admin.from("analysis_events").select("id, type, payload, created_at").eq("analysis_id", id).order("id"),
    "events",
  ) as Row[];
  const [conditions, batches, variants] = await Promise.all([
    admin.from("conditions").select("id", { count: "exact", head: true }).eq("analysis_id", id),
    admin.from("panel_batches").select("status").eq("analysis_id", id),
    admin.from("variants").select("id", { count: "exact", head: true }).eq("analysis_id", id),
  ]);
  const b = (batches.data ?? []) as Array<{ status: string }>;
  return json({
    analysis,
    statusTimeline: events.filter((e) => e["type"] === "status_changed"),
    events,
    counts: {
      conditions: conditions.count ?? 0,
      batchesDone: b.filter((x) => x.status === "done" || x.status === "failed").length,
      batchesTotal: b.length,
      variants: variants.count ?? 0,
    },
  });
}

export async function getRegions(id: string, { uid, admin }: Auth): Promise<Response> {
  const a = await owned<Row>(admin, "analyses", id, uid);
  const ad = await owned<Row>(admin, "ads", a["target_ad_id"] as string, uid);
  const regions = check(
    await admin.from("regions").select("*").eq("analysis_id", id).eq("ad_id", ad["id"]).order("created_at"),
    "regions",
  );
  const imageUrl = ad["normalized_path"] ? await signUrl(admin, "ads-derived", ad["normalized_path"] as string) : null;
  return json({ regions, imageUrl, width: ad["width"], height: ad["height"], status: a["status"] });
}

export async function putRegions(req: Request, id: string, { uid, admin }: Auth): Promise<Response> {
  const body = await readBody(req, PutRegionsBody);
  const a = await owned<Row>(admin, "analyses", id, uid);
  if (a["status"] !== "needs_review") throw new ApiError(409, "wrong_status", "Regions can only be edited during review");
  const adId = a["target_ad_id"] as string;
  const keep = body.regions.flatMap((r) => (r.id ? [r.id] : []));
  const existing = check(await admin.from("regions").select("id").eq("analysis_id", id).eq("ad_id", adId), "regions") as Array<{ id: string }>;
  const drop = existing.map((r) => r.id).filter((x) => !keep.includes(x));
  if (drop.length > 0) check(await admin.from("regions").delete().in("id", drop), "delete regions");
  for (const r of body.regions) {
    const row = { kind: r.kind, box: [...clampNorm(r.box)], label: r.label ?? null, approved: r.approved, source: "manual" };
    if (r.id) {
      if (!existing.some((e) => e.id === r.id)) throw new ApiError(404, "not_found", `region ${r.id} not found`);
      check(await admin.from("regions").update(row).eq("id", r.id), "update region");
    } else {
      check(await admin.from("regions").insert({ ...row, ad_id: adId, analysis_id: id, confidence: 1 }), "insert region");
    }
  }
  return getRegions(id, { uid, admin });
}

export async function approveRegions(req: Request, id: string, { uid, admin }: Auth): Promise<Response> {
  const body = await readBody(req, ApproveBody);
  await owned<Row>(admin, "analyses", id, uid);
  if (body.force) {
    const { error } = await admin.rpc("config_merge", { p_id: id, p_patch: { leakOverride: true } });
    if (error) throw new Error(error.message);
  }
  if (!(await transition(admin, id, ["needs_review"], "masking"))) {
    throw new ApiError(409, "wrong_status", "Analysis is not waiting for region review");
  }
  await enqueue(admin, { type: "leak_check", analysisId: id, idem: `leak_check:${id}:${Date.now()}` });
  return json({ queued: true });
}

export async function getConditions(id: string, { uid, admin }: Auth): Promise<Response> {
  await owned<Row>(admin, "analyses", id, uid);
  const conditions = check(await admin.from("conditions").select("*").eq("analysis_id", id).order("created_at"), "conditions") as Row[];
  const metrics = check(await admin.from("condition_metrics").select("*").eq("analysis_id", id), "metrics") as Row[];
  const out = [];
  for (const c of conditions) {
    out.push({ ...c, imageUrl: await signUrl(admin, "ads-derived", c["image_path"] as string), metrics: metrics.find((m) => m["condition_id"] === c["id"]) ?? null });
  }
  return json(out);
}

export async function getDiagnosis(id: string, { uid, admin }: Auth): Promise<Response> {
  await owned<Row>(admin, "analyses", id, uid);
  const [impacts, findings, similarity, brands] = await Promise.all([
    admin.from("element_impacts").select("*").eq("analysis_id", id),
    admin.from("findings").select("*").eq("analysis_id", id).order("severity", { ascending: false }),
    admin.from("similarity").select("*").eq("analysis_id", id).maybeSingle(),
    admin.from("analysis_brands").select("*").eq("analysis_id", id),
  ]);
  return json({ elementImpacts: impacts.data ?? [], findings: findings.data ?? [], similarity: similarity.data, brands: brands.data ?? [] });
}

export async function getVariants(id: string, { uid, admin }: Auth): Promise<Response> {
  await owned<Row>(admin, "analyses", id, uid);
  const variants = check(await admin.from("variants").select("*").eq("analysis_id", id).order("idx"), "variants") as Row[];
  const conds = check(await admin.from("conditions").select("id, variant_id, image_path").eq("analysis_id", id).eq("kind", "variant"), "conditions") as Row[];
  const out = [];
  for (const v of variants) {
    const c = conds.find((x) => x["variant_id"] === v["id"]);
    out.push({
      ...v,
      renderUrl: v["original_render_path"] ? await signUrl(admin, "ads-derived", v["original_render_path"] as string) : null,
      maskedUrl: c ? await signUrl(admin, "ads-derived", c["image_path"] as string) : null,
    });
  }
  return json(out);
}

export async function getReport(id: string, { uid, admin }: Auth): Promise<Response> {
  await owned<Row>(admin, "analyses", id, uid);
  const { data } = await admin.from("reports").select("*").eq("analysis_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new ApiError(404, "not_found", "No report yet");
  return json({ markdown: data.markdown, data: data.data, numberCheck: data.number_check, model: data.model });
}

function pacificDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function getQuota({ admin }: Auth): Promise<Response> {
  const day = pacificDay();
  const usage = check(await admin.from("ai_quota").select("*").eq("day", day), "quota") as Array<{ model: string; requests: number; last_429_at: string | null }>;
  let limits: Record<string, { rpm: number; rpd: number }> = {};
  try {
    limits = JSON.parse(Deno.env.get("QUOTAS_JSON") ?? "{}");
  } catch {
    // Limits are optional here; the worker env is authoritative.
  }
  return json({ day, models: usage.map((u) => ({ model: u.model, used: u.requests, limit: limits[u.model]?.rpd ?? null, last429: u.last_429_at })) });
}
