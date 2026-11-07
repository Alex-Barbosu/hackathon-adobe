import { z } from "zod";

const QuotaSchema = z.object({
  rpm: z.coerce.number().int().positive(),
  rpd: z.coerce.number().int().positive(),
});
export type Quota = z.infer<typeof QuotaSchema>;

const QuotasJsonSchema = z.record(z.string(), QuotaSchema);

const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  MODEL_PANEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  MODEL_DETECT: z.string().min(1).default("gemini-3.5-flash-lite"),
  MODEL_QUIZ: z.string().min(1).default("gemini-3.5-flash-lite"),
  MODEL_BRANDFIT: z.string().min(1).default("gemini-3.5-flash-lite"),
  MODEL_PLAN: z.string().min(1).default("gemini-3.8-flash"),
  MODEL_REPORT: z.string().min(1).default("gemini-3.8-flash"),
  MODEL_FALLBACK: z.string().min(1).default("gemini-3.5-flash-lite"),
  MODEL_EMBED: z.string().min(1).default("gemini-embedding-2"),
  EMBED_DIMS: z.coerce.number().int().positive().default(768),
  QUOTA_SAFETY_MARGIN: z.coerce.number().gt(0).lte(1).default(0.9),
  ENABLE_GENERATIVE_EDITS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_IMAGE_MODEL: z.string().default("@cf/black-forest-labs/flux-2-klein-4b"),
  PANEL_PRESET: z.enum(["free", "strict"]).default("free"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(750),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema> & { quotas: Record<string, Quota> };

// Model ids contain dots and dashes, which many shells reject in var names; QUOTAS_JSON avoids that.
export function parseQuotas(raw: Record<string, string | undefined>): Record<string, Quota> {
  if (raw["QUOTAS_JSON"]) return QuotasJsonSchema.parse(JSON.parse(raw["QUOTAS_JSON"]));
  const partial = new Map<string, { rpm?: number; rpd?: number }>();
  for (const [key, value] of Object.entries(raw)) {
    const m = /^QUOTA_(.+)_(RPM|RPD)$/.exec(key);
    if (!m?.[1] || !m[2] || value === undefined) continue;
    const entry = partial.get(m[1]) ?? {};
    entry[m[2] === "RPM" ? "rpm" : "rpd"] = Number(value);
    partial.set(m[1], entry);
  }
  return QuotasJsonSchema.parse(Object.fromEntries(partial));
}

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return { ...parsed.data, quotas: parseQuotas(raw) };
}

export function requiredModels(env: Env): string[] {
  return [
    ...new Set([
      env.MODEL_PANEL,
      env.MODEL_DETECT,
      env.MODEL_QUIZ,
      env.MODEL_BRANDFIT,
      env.MODEL_PLAN,
      env.MODEL_REPORT,
      env.MODEL_FALLBACK,
      env.MODEL_EMBED,
    ]),
  ];
}
