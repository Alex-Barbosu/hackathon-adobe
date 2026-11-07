import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, l2Normalize } from "@nologo/core";
import { pacificDay } from "../db.ts";
import {
  FatalError,
  HttpError,
  QuotaExhaustedError,
  RetryableError,
  SchemaInvalidError,
  errorMessage,
  isRetryableStatus,
} from "../errors.ts";
import type { EmbedRequest, EmbedResult, JsonRequest, LlmClient, LlmResult } from "./client.ts";
import { realClock, type Clock, type RateLimiter } from "./limiter.ts";
import { modelChain, thinkingLevel, type ModelNames } from "./routing.ts";
import type { LlmStore } from "./store.ts";
import type { Transport } from "./transport.ts";

export interface LlmServiceOptions {
  models: ModelNames & { MODEL_EMBED: string };
  embedDims: number;
  rpd: Readonly<Record<string, number>>;
  safetyMargin: number;
  limiter: RateLimiter;
  transport: Transport;
  store: LlmStore;
  clock?: Clock;
  random?: () => number;
  maxAttempts?: number;
  timeoutMs?: number;
}

const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60_000;
interface LogMeta {
  task: string;
  promptVersion: string;
  analysisId?: string | undefined;
}

const WARN_LEVELS = [0.7, 0.9] as const;

function stripFences(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return (m?.[1] ?? text).trim();
}

export function cacheKey(model: string, req: JsonRequest<unknown>): string {
  const textParts = req.parts.flatMap((p) => (p.kind === "text" ? [p.text] : []));
  const imageShas = req.parts.flatMap((p) => (p.kind === "image" ? [p.sha256] : []));
  return createHash("sha256")
    .update(
      canonicalJson({
        model,
        task: req.task,
        promptVersion: req.promptVersion,
        system: req.system,
        textParts,
        imageShas,
        temperature: req.temperature,
        cacheKeyExtra: req.cacheKeyExtra ?? {},
      }),
    )
    .digest("hex");
}

export function schemaToJson(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}

// Cache -> RPD quota -> RPM bucket -> call -> parse/repair -> retry -> log -> cache (spec 9.3).
export class LlmService implements LlmClient {
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly warned = new Set<string>();

  constructor(private readonly o: LlmServiceOptions) {
    this.clock = o.clock ?? realClock;
    this.random = o.random ?? Math.random;
    this.maxAttempts = o.maxAttempts ?? 4;
  }

  private dayNow(): string {
    return pacificDay(this.clock.now());
  }

  private dailyLimit(model: string): number {
    return Math.floor((this.o.rpd[model] ?? 0) * this.o.safetyMargin);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<LlmResult<T>> {
    const chain = modelChain(req.task, this.o.models);
    for (const model of chain) {
      const hit = await this.fromCache(model, req);
      if (hit) return hit;
    }
    let lastQuota: QuotaExhaustedError | undefined;
    for (const model of chain) {
      try {
        return await this.callModel(model, req);
      } catch (err) {
        if (!(err instanceof QuotaExhaustedError)) throw err;
        lastQuota = err;
        if (req.analysisId) await this.o.store.emit(req.analysisId, "quota_exhausted", { model });
      }
    }
    throw lastQuota ?? new QuotaExhaustedError(chain[0] ?? "unknown");
  }

  private async fromCache<T>(model: string, req: JsonRequest<T>): Promise<LlmResult<T> | undefined> {
    const raw = await this.o.store.cacheGet(cacheKey(model, req));
    if (raw === undefined) return undefined;
    // Cache stores only schema-valid output, but a prompt/schema change must not resurrect stale shapes.
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) return undefined;
    await this.log(req, model, { cacheHit: true, status: "ok", attempt: 1 });
    return { data: parsed.data, model, cacheHit: true };
  }

  private log(
    req: LogMeta,
    model: string,
    c: Partial<Parameters<LlmStore["logCall"]>[0]> & Pick<Parameters<LlmStore["logCall"]>[0], "cacheHit" | "status" | "attempt">,
  ): Promise<void> {
    return this.o.store.logCall({ analysisId: req.analysisId, task: req.task, model, promptVersion: req.promptVersion, ...c });
  }

  // Reserves one real request against the daily budget; throws when the budget is spent.
  private async reserve(model: string, req: LogMeta, attempt: number): Promise<void> {
    const day = this.dayNow();
    const limit = this.dailyLimit(model);
    const granted = await this.o.store.bumpQuota(model, day, limit);
    if (!granted) {
      await this.log(req, model, { cacheHit: false, status: "quota_blocked", attempt });
      throw new QuotaExhaustedError(model);
    }
    await this.warnIfNeeded(model, day, limit, req.analysisId);
  }

  private async warnIfNeeded(model: string, day: string, limit: number, analysisId?: string): Promise<void> {
    if (!analysisId || limit < 1) return;
    const used = await this.o.store.quotaUsed(model, day);
    for (const level of WARN_LEVELS) {
      const tag = `${model}|${day}|${level}`;
      if (used / limit >= level && !this.warned.has(tag)) {
        this.warned.add(tag);
        await this.o.store.emit(analysisId, "quota_warning", { model, used, limit });
      }
    }
  }

  private async backoff(attempt: number, err: HttpError): Promise<void> {
    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
    // Full jitter, but never shorter than what the server asked for.
    await this.clock.sleep(Math.max(err.retryAfterMs ?? 0, Math.floor(this.random() * ceiling)));
  }

  // One real request with retry on 429/5xx/network. `onSuccess` receives the raw text.
  private async rawCall(
    model: string,
    req: JsonRequest<unknown>,
    parts: JsonRequest<unknown>["parts"],
    firstAttempt: number,
  ): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } | undefined; attempt: number }> {
    for (let attempt = firstAttempt; ; attempt++) {
      await this.reserve(model, req, attempt);
      await this.o.limiter.acquire(model);
      const t0 = this.clock.now();
      try {
        const res = await this.o.transport.generate({
          model,
          system: req.system,
          parts,
          schemaJson: schemaToJson(req.schema),
          thinkingLevel: thinkingLevel(req.task, model),
          timeoutMs: this.o.timeoutMs ?? 60_000,
        });
        await this.log(req, model, {
          cacheHit: false,
          status: "ok",
          attempt,
          latencyMs: this.clock.now() - t0,
          inputTokens: res.usage?.inputTokens,
          outputTokens: res.usage?.outputTokens,
        });
        return { text: res.text, usage: res.usage, attempt };
      } catch (err) {
        const http = err instanceof HttpError ? err : new HttpError(errorMessage(err), 0);
        const retryable = http.status === 0 || isRetryableStatus(http.status);
        await this.log(req, model, {
          cacheHit: false,
          status: retryable ? "retry" : "error",
          attempt,
          httpStatus: http.status || undefined,
          latencyMs: this.clock.now() - t0,
          error: http.message,
        });
        if (!retryable) throw new FatalError(`Model call rejected (${http.status}): ${http.message}`);
        if (http.status === 429) {
          this.o.limiter.coolDown(model, http.retryAfterMs ?? BACKOFF_BASE_MS);
          await this.o.store.note429(model, this.dayNow());
        }
        if (attempt - firstAttempt + 1 >= this.maxAttempts) {
          throw new RetryableError(`Model call failed after ${this.maxAttempts} attempts: ${http.message}`);
        }
        await this.backoff(attempt - firstAttempt + 1, http);
      }
    }
  }

  private parse<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; issues: string[] } {
    let json: unknown;
    try {
      json = JSON.parse(stripFences(text));
    } catch {
      return { ok: false, issues: ["output is not valid JSON"] };
    }
    const r = schema.safeParse(json);
    return r.success
      ? { ok: true, data: r.data }
      : { ok: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }

  private async callModel<T>(model: string, req: JsonRequest<T>): Promise<LlmResult<T>> {
    const first = await this.rawCall(model, req, req.parts, 1);
    let parsed = this.parse(req.schema, first.text);
    let usage = first.usage;
    if (!parsed.ok) {
      // One repair attempt: show the model its own output and the exact problems. It counts as a call.
      await this.log(req, model, { cacheHit: false, status: "schema_invalid", attempt: first.attempt, error: parsed.issues.join("; ") });
      const repairParts: JsonRequest<T>["parts"] = [
        ...req.parts,
        {
          kind: "text",
          text: `Your previous answer did not match the schema.\nProblems:\n- ${parsed.issues.join("\n- ")}\nPrevious answer:\n${first.text.slice(0, 4000)}\nReturn corrected JSON only.`,
        },
      ];
      const second = await this.rawCall(model, req, repairParts, first.attempt + 1);
      usage = second.usage ?? usage;
      parsed = this.parse(req.schema, second.text);
      if (!parsed.ok) {
        await this.log(req, model, { cacheHit: false, status: "schema_invalid", attempt: second.attempt, error: parsed.issues.join("; ") });
        throw new SchemaInvalidError(`Model output failed schema validation after repair: ${parsed.issues.join("; ")}`, parsed.issues);
      }
    }
    await this.o.store.cachePut({
      key: cacheKey(model, req),
      task: req.task,
      model,
      promptVersion: req.promptVersion,
      response: parsed.data,
    });
    return { data: parsed.data, model, cacheHit: false, ...(usage ? { usage } : {}) };
  }

  async embedImage(req: EmbedRequest): Promise<EmbedResult> {
    const model = this.o.models.MODEL_EMBED;
    const key = createHash("sha256")
      .update(canonicalJson({ model, task: "embed", sha: req.sha256, dims: this.o.embedDims }))
      .digest("hex");
    const meta = { task: "embed", promptVersion: "embed@1", analysisId: req.analysisId } as const;
    const hit = await this.o.store.cacheGet(key);
    const cached = z.object({ vector: z.array(z.number()) }).safeParse(hit);
    if (cached.success && cached.data.vector.length === this.o.embedDims) {
      await this.log(meta, model, { cacheHit: true, status: "ok", attempt: 1 });
      return { vector: cached.data.vector, model, cacheHit: true };
    }
    for (let attempt = 1; ; attempt++) {
      await this.reserve(model, meta, attempt);
      await this.o.limiter.acquire(model);
      const t0 = this.clock.now();
      try {
        const raw = await this.o.transport.embed({ model, png: req.png, dims: this.o.embedDims });
        if (raw.length !== this.o.embedDims) {
          throw new FatalError(`Embedding has ${raw.length} dims, expected ${this.o.embedDims}`);
        }
        // The API already normalizes below 3072 dims; we normalize anyway (cheap, and verified docs may change).
        const vector = l2Normalize(raw);
        await this.log(meta, model, { cacheHit: false, status: "ok", attempt, latencyMs: this.clock.now() - t0 });
        await this.o.store.cachePut({ key, task: "embed", model, promptVersion: "embed@1", response: { vector } });
        return { vector, model, cacheHit: false };
      } catch (err) {
        if (err instanceof FatalError || err instanceof QuotaExhaustedError) throw err;
        const http = err instanceof HttpError ? err : new HttpError(errorMessage(err), 0);
        const retryable = http.status === 0 || isRetryableStatus(http.status);
        await this.log(meta, model, { cacheHit: false, status: retryable ? "retry" : "error", attempt, httpStatus: http.status || undefined, error: http.message });
        if (!retryable) throw new FatalError(`Embedding rejected (${http.status}): ${http.message}`);
        if (http.status === 429) this.o.limiter.coolDown(model, http.retryAfterMs ?? BACKOFF_BASE_MS);
        if (attempt >= this.maxAttempts) throw new RetryableError(`Embedding failed after ${attempt} attempts: ${http.message}`);
        await this.backoff(attempt, http);
      }
    }
  }
}
