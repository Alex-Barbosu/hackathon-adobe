// Thresholds and presets live here (pure data) so analyses can freeze a copy at creation.

export const MASK_HEX = "#8C8F93";
export const MASK_RGB = [0x8c, 0x8f, 0x93] as const;

export const REGION_KINDS = [
  "logo",
  "brand_name",
  "packaging_text",
  "url_or_handle",
  "mascot_character",
  "product",
  "other_text",
  "person",
  "graphic_element",
] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

export const IDENTIFIER_KINDS = ["logo", "brand_name", "packaging_text", "url_or_handle"] as const;

export function isIdentifierKind(kind: RegionKind): boolean {
  return (IDENTIFIER_KINDS as readonly string[]).includes(kind);
}

export const ELEMENTS = ["color", "mascot_character", "product", "other_text", "layout"] as const;
export type Element = (typeof ELEMENTS)[number];

// Cue-only dimensions the panel may cite but v1 cannot ablate.
export const CUE_ELEMENTS = [...ELEMENTS, "typography", "photography", "other"] as const;

export const DEFAULT_THRESHOLDS = {
  strongAssetDeltaLow: 0.1,
  strongAssetCueShare: 0.25,
  decorationAbsMean: 0.03,
  traitorPullShift: 0.1,
  genericPercentile: 0.75,
  knownBrandControl: 0.5,
  leakShare: 0.15,
} as const;
export type Thresholds = { -readonly [K in keyof typeof DEFAULT_THRESHOLDS]: number };

export const PANEL_PRESETS = {
  free: { callsPerCondition: 2, personasPerCall: 6, exposuresPerBrand: 2 },
  strict: { callsPerCondition: 12, personasPerCall: 1, exposuresPerBrand: 2 },
} as const;
export type PresetName = keyof typeof PANEL_PRESETS;

// Share of changed pixels a plan may touch, by the brief's change budget (1..5).
export const CHANGE_CAPS: Readonly<Record<number, number>> = { 1: 0.1, 2: 0.2, 3: 0.35, 4: 0.5, 5: 0.7 };

export const BOOTSTRAP_B = 2000;
export const NEAR_DUPLICATE_SIMILARITY = 0.97;
export const MASK_PAD_RATIO = 0.08;
export const MASK_PAD_MIN_PX = 6;
export const GUARD_MAX_CHANGED_OUTSIDE = 0.002;
// Per-channel-sum difference that counts as a real change; tolerates PNG and rounding noise.
export const GUARD_PIXEL_THRESHOLD = 3 * 12;
// Boxes below 0.05% of the 1000x1000 normalized canvas are noise.
export const MIN_REGION_AREA = 500;
export const MERGE_IOU = 0.5;

export const MAX_JOB_ATTEMPTS = 5;
export const EXPOSURE_LONG_SIDE = 512;
export const NORMALIZED_LONG_SIDE = 1024;
export const EMBED_DIMS_DEFAULT = 768;

export const MAX_QUESTIONS = 12;
export const SOFT_LIMIT = 10;
export const OPTIONAL_MIN_PRIORITY = 60;
export const PAIRWISE_ROUNDS = 3;

export const TEMPERATURES = {
  panel: 1.0,
  detect: 0,
  leak_check: 0,
  quiz_bank: 0.7,
  directions: 0.9,
  plan: 0.6,
  plan_repair: 0.3,
  brand_fit: 0,
  report: 0.3,
} as const;

export interface AnalysisConfig {
  thresholds: Thresholds;
  panel: { callsPerCondition: number; personasPerCall: number; exposuresPerBrand: number };
  elements: Element[];
  bootstrapB: number;
  includePersonInPeopleAblation: boolean;
  // Filled as the pipeline learns things; kept in config so the result is reproducible from the row.
  skippedElements?: Element[];
  leakOverride?: boolean;
  competitorPalettes?: Record<string, string[]>;
  targetPalette?: string[];
}

export function resolveConfig(preset: PresetName): AnalysisConfig {
  return {
    thresholds: { ...DEFAULT_THRESHOLDS },
    panel: { ...PANEL_PRESETS[preset] },
    elements: [...ELEMENTS],
    bootstrapB: BOOTSTRAP_B,
    includePersonInPeopleAblation: true,
  };
}
