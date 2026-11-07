import { z } from "zod";
import {
  DEFAULT_THRESHOLDS,
  ELEMENTS,
  PANEL_PRESETS,
  clampNorm,
  type Element,
  type NormBox,
} from "@nologo/core";
import { must, mustOk, toJson, type Database, type Db } from "../db.ts";
import { FatalError } from "../errors.ts";

type Tables = Database["public"]["Tables"];
export type Row<T extends keyof Tables> = Tables[T]["Row"];

const Thresholds = z.object({
  strongAssetDeltaLow: z.number().default(DEFAULT_THRESHOLDS.strongAssetDeltaLow),
  strongAssetCueShare: z.number().default(DEFAULT_THRESHOLDS.strongAssetCueShare),
  decorationAbsMean: z.number().default(DEFAULT_THRESHOLDS.decorationAbsMean),
  traitorPullShift: z.number().default(DEFAULT_THRESHOLDS.traitorPullShift),
  genericPercentile: z.number().default(DEFAULT_THRESHOLDS.genericPercentile),
  knownBrandControl: z.number().default(DEFAULT_THRESHOLDS.knownBrandControl),
  leakShare: z.number().default(DEFAULT_THRESHOLDS.leakShare),
});

export const AnalysisConfig = z.object({
  thresholds: Thresholds.default(() => Thresholds.parse({})),
  panel: z
    .object({ callsPerCondition: z.number(), personasPerCall: z.number(), exposuresPerBrand: z.number() })
    .default({ ...PANEL_PRESETS.free }),
  elements: z.array(z.enum(ELEMENTS)).default([...ELEMENTS]),
  bootstrapB: z.number().default(2000),
  includePersonInPeopleAblation: z.boolean().default(true),
  skippedElements: z.array(z.enum(ELEMENTS)).default([]),
  leakOverride: z.boolean().default(false),
  competitorPalettes: z.record(z.string(), z.array(z.string())).default({}),
  targetPalette: z.array(z.string()).default([]),
  refsDone: z.array(z.string()).default([]),
});
export type AnalysisConfigValue = z.infer<typeof AnalysisConfig>;

export interface Analysis extends Row<"analyses"> {
  cfg: AnalysisConfigValue;
}

export async function getAnalysis(db: Db, id: string): Promise<Analysis> {
  const row = must(await db.from("analyses").select("*").eq("id", id).single(), `analysis ${id}`);
  return { ...row, cfg: AnalysisConfig.parse(row.config) };
}

export async function mergeConfig(db: Db, id: string, patch: Partial<AnalysisConfigValue>): Promise<void> {
  mustOk(await db.rpc("config_merge", { p_id: id, p_patch: toJson(patch) }), "config_merge");
}

export async function appendConfig(db: Db, id: string, key: "refsDone", value: string): Promise<void> {
  mustOk(await db.rpc("config_append", { p_id: id, p_key: key, p_value: value }), "config_append");
}

export async function getAd(db: Db, id: string): Promise<Row<"ads">> {
  return must(await db.from("ads").select("*").eq("id", id).single(), `ad ${id}`);
}

export async function getAds(db: Db, ids: string[]): Promise<Row<"ads">[]> {
  if (ids.length === 0) return [];
  return must(await db.from("ads").select("*").in("id", ids), "ads");
}

export interface AnalysisBrand {
  brandId: string;
  label: string;
  isTarget: boolean;
}

export async function getBrands(db: Db, analysisId: string): Promise<AnalysisBrand[]> {
  const rows = must(await db.from("analysis_brands").select("*").eq("analysis_id", analysisId), "analysis_brands");
  return rows
    .map((r) => ({ brandId: r.brand_id, label: r.candidate_label, isTarget: r.is_target }))
    .sort((a, b) => (a.brandId < b.brandId ? -1 : 1));
}

export async function getAnalysisAds(db: Db, analysisId: string): Promise<Array<Row<"analysis_ads">>> {
  return must(await db.from("analysis_ads").select("*").eq("analysis_id", analysisId), "analysis_ads");
}

export interface RegionLite {
  id: string;
  adId: string;
  kind: Row<"regions">["kind"];
  label: string | null;
  box: NormBox;
  approved: boolean;
  isIdentifier: boolean;
}

export function toRegion(r: Row<"regions">): RegionLite {
  return {
    id: r.id,
    adId: r.ad_id,
    kind: r.kind,
    label: r.label,
    box: clampNorm(r.box),
    approved: r.approved,
    isIdentifier: r.is_identifier ?? false,
  };
}

export async function getAnalysisRegions(db: Db, analysisId: string, adId: string): Promise<RegionLite[]> {
  const rows = must(
    await db.from("regions").select("*").eq("analysis_id", analysisId).eq("ad_id", adId).order("id"),
    "regions",
  );
  return rows.map(toRegion);
}

export async function getAdLevelRegions(db: Db, adId: string): Promise<RegionLite[]> {
  const rows = must(await db.from("regions").select("*").is("analysis_id", null).eq("ad_id", adId).order("id"), "ad regions");
  return rows.map(toRegion);
}

export function requireNormalizedPath(ad: Row<"ads">): string {
  if (!ad.normalized_path) throw new FatalError(`Ad ${ad.id} has not been normalized yet`);
  return ad.normalized_path;
}

export function competitorIds(brands: readonly AnalysisBrand[]): string[] {
  return brands.filter((b) => !b.isTarget).map((b) => b.brandId);
}

export function targetBrandId(brands: readonly AnalysisBrand[]): string {
  const t = brands.find((b) => b.isTarget);
  if (!t) throw new FatalError("Analysis has no target brand");
  return t.brandId;
}

export function elementList(cfg: AnalysisConfigValue): Element[] {
  return cfg.elements.filter((e) => !cfg.skippedElements.includes(e));
}

export function parseJson<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new FatalError(`${what}: unexpected shape (${r.error.issues[0]?.message ?? "invalid"})`);
  return r.data;
}

export const NumberRecord = z.record(z.string(), z.number());
export const NumberPairRecord = z.record(z.string(), z.tuple([z.number(), z.number()]));
export const CueList = z.array(z.object({ element: z.string(), text: z.string() }));
export const Pair = z.tuple([z.number(), z.number()]);
