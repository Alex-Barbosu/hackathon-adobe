import { mustOk, toJson, type Db } from "../db.ts";

export interface CallLog {
  analysisId?: string | undefined;
  task: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  status: "ok" | "retry" | "error" | "quota_blocked" | "schema_invalid";
  httpStatus?: number | undefined;
  latencyMs?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  attempt: number;
  error?: string | undefined;
}

export interface CacheEntry {
  key: string;
  task: string;
  model: string;
  promptVersion: string;
  response: unknown;
}

// Everything the LLM service persists. The Supabase implementation is below; tests use the memory one.
export interface LlmStore {
  cacheGet(key: string): Promise<unknown>;
  cachePut(entry: CacheEntry): Promise<void>;
  bumpQuota(model: string, day: string, limit: number): Promise<boolean>;
  quotaUsed(model: string, day: string): Promise<number>;
  note429(model: string, day: string): Promise<void>;
  logCall(call: CallLog): Promise<void>;
  emit(analysisId: string, type: string, payload: Record<string, unknown>): Promise<void>;
}

export class SupabaseLlmStore implements LlmStore {
  constructor(private readonly db: Db) {}

  async cacheGet(key: string): Promise<unknown> {
    const { data, error } = await this.db.from("ai_cache").select("response, hits").eq("key", key).maybeSingle();
    mustOk({ error }, "ai_cache read");
    if (!data) return undefined;
    // Hit counter is advisory; a lost update is harmless.
    await this.db.from("ai_cache").update({ hits: data.hits + 1 }).eq("key", key);
    return data.response;
  }

  async cachePut(e: CacheEntry): Promise<void> {
    const res = await this.db.from("ai_cache").upsert(
      { key: e.key, task: e.task, model: e.model, prompt_version: e.promptVersion, response: toJson(e.response) },
      { onConflict: "key" },
    );
    mustOk(res, "ai_cache write");
  }

  async bumpQuota(model: string, day: string, limit: number): Promise<boolean> {
    const { data, error } = await this.db.rpc("bump_quota", { p_model: model, p_day: day, p_limit: limit });
    mustOk({ error }, "bump_quota");
    return data === true;
  }

  async quotaUsed(model: string, day: string): Promise<number> {
    const { data, error } = await this.db.rpc("quota_used", { p_model: model, p_day: day });
    mustOk({ error }, "quota_used");
    return data ?? 0;
  }

  async note429(model: string, day: string): Promise<void> {
    mustOk(await this.db.rpc("note_429", { p_model: model, p_day: day }), "note_429");
  }

  async logCall(c: CallLog): Promise<void> {
    const res = await this.db.from("ai_calls").insert({
      analysis_id: c.analysisId ?? null,
      task: c.task,
      model: c.model,
      prompt_version: c.promptVersion,
      cache_hit: c.cacheHit,
      status: c.status,
      http_status: c.httpStatus ?? null,
      latency_ms: c.latencyMs ?? null,
      input_tokens: c.inputTokens ?? null,
      output_tokens: c.outputTokens ?? null,
      attempt: c.attempt,
      error: c.error?.slice(0, 1000) ?? null,
    });
    mustOk(res, "ai_calls insert");
  }

  async emit(analysisId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    mustOk(await this.db.rpc("emit_event", { p_analysis_id: analysisId, p_type: type, p_payload: toJson(payload) }), "emit_event");
  }
}

export class MemoryLlmStore implements LlmStore {
  readonly cache = new Map<string, unknown>();
  readonly quota = new Map<string, number>();
  readonly calls: CallLog[] = [];
  readonly events: Array<{ analysisId: string; type: string; payload: Record<string, unknown> }> = [];
  readonly notes429: string[] = [];

  cacheGet(key: string): Promise<unknown> {
    return Promise.resolve(this.cache.get(key));
  }
  cachePut(e: CacheEntry): Promise<void> {
    this.cache.set(e.key, e.response);
    return Promise.resolve();
  }
  bumpQuota(model: string, day: string, limit: number): Promise<boolean> {
    const k = `${model}|${day}`;
    const used = this.quota.get(k) ?? 0;
    if (limit < 1 || used >= limit) return Promise.resolve(false);
    this.quota.set(k, used + 1);
    return Promise.resolve(true);
  }
  quotaUsed(model: string, day: string): Promise<number> {
    return Promise.resolve(this.quota.get(`${model}|${day}`) ?? 0);
  }
  note429(model: string): Promise<void> {
    this.notes429.push(model);
    return Promise.resolve();
  }
  logCall(call: CallLog): Promise<void> {
    this.calls.push(call);
    return Promise.resolve();
  }
  emit(analysisId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    this.events.push({ analysisId, type, payload });
    return Promise.resolve();
  }
}
