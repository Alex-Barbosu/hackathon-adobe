import { z } from "zod";
import { describe, expect, it } from "vitest";
import { FatalError, HttpError, QuotaExhaustedError, SchemaInvalidError } from "../errors.ts";
import { pacificDay } from "../db.ts";
import type { JsonRequest } from "./client.ts";
import { FakeLlmClient } from "./fake.ts";
import { retryDelayMs } from "./gemini.ts";
import { RateLimiter, type Clock } from "./limiter.ts";
import { thinkingLevel, modelChain } from "./routing.ts";
import { LlmService, cacheKey, schemaToJson } from "./service.ts";
import { MemoryLlmStore } from "./store.ts";
import type { EmbedTransportRequest, GenerateRequest, GenerateResponse, Transport } from "./transport.ts";

class FakeClock implements Clock {
  t = Date.UTC(2026, 10, 7, 20, 0, 0);
  readonly sleeps: number[] = [];
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
    return Promise.resolve();
  }
}

type Step = GenerateResponse | Error;

class ScriptedTransport implements Transport {
  readonly requests: GenerateRequest[] = [];
  embedCalls = 0;
  constructor(
    private readonly steps: Step[],
    private readonly embedVector: number[] = [3, 4, ...new Array<number>(766).fill(0)],
  ) {}
  generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.requests.push(req);
    const s = this.steps.shift();
    if (!s) return Promise.reject(new Error("script exhausted"));
    return s instanceof Error ? Promise.reject(s) : Promise.resolve(s);
  }
  embed(_req: EmbedTransportRequest): Promise<number[]> {
    this.embedCalls++;
    return Promise.resolve(this.embedVector);
  }
  listModels(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

const models = {
  MODEL_PANEL: "flash-lite",
  MODEL_DETECT: "flash-lite",
  MODEL_QUIZ: "flash-lite",
  MODEL_BRANDFIT: "flash-lite",
  MODEL_PLAN: "flash",
  MODEL_REPORT: "flash",
  MODEL_FALLBACK: "flash-lite",
  MODEL_EMBED: "embed",
};

function setup(steps: Step[], rpd: Record<string, number> = { flash: 20, "flash-lite": 500, embed: 1000 }) {
  const clock = new FakeClock();
  const store = new MemoryLlmStore();
  const transport = new ScriptedTransport(steps);
  const limiter = new RateLimiter({ flash: 5, "flash-lite": 10, embed: 10 }, 0.9, clock);
  const svc = new LlmService({
    models,
    embedDims: 768,
    rpd,
    safetyMargin: 1,
    limiter,
    transport,
    store,
    clock,
    random: () => 0.5,
  });
  return { clock, store, transport, limiter, svc };
}

const Out = z.object({ answer: z.number() });
const req = (over: Partial<JsonRequest<{ answer: number }>> = {}): JsonRequest<{ answer: number }> => ({
  task: "panel",
  promptVersion: "panel@1",
  system: "sys",
  parts: [{ kind: "text", text: "hello" }],
  schema: Out,
  temperature: 1,
  analysisId: "a1",
  ...over,
});
const ok = (v: unknown): GenerateResponse => ({ text: JSON.stringify(v), usage: { inputTokens: 5, outputTokens: 3 } });

describe("LlmService", () => {
  it("serves a repeated request from cache without a second call", async () => {
    const { svc, transport, store } = setup([ok({ answer: 1 })]);
    const a = await svc.generateJson(req());
    const b = await svc.generateJson(req());
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(true);
    expect(b.data).toEqual({ answer: 1 });
    expect(transport.requests).toHaveLength(1);
    expect(store.calls.map((c) => [c.cacheHit, c.status])).toEqual([[false, "ok"], [true, "ok"]]);
    expect(a.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
  });

  it("retries 429 with backoff and records it, then succeeds", async () => {
    const { svc, store, clock, transport } = setup([new HttpError("rate limited", 429, 4000), ok({ answer: 2 })]);
    const r = await svc.generateJson(req());
    expect(r.data.answer).toBe(2);
    expect(store.notes429).toEqual(["flash-lite"]);
    expect(store.calls.map((c) => c.status)).toEqual(["retry", "ok"]);
    expect(clock.sleeps.some((s) => s >= 4000)).toBe(true);
    expect(transport.requests).toHaveLength(2);
    // Every real attempt consumed one unit of the daily budget.
    expect(store.quota.get(`flash-lite|${pacificDay(clock.t)}`)).toBe(2);
  });

  it("gives up after the maximum attempts on persistent 5xx", async () => {
    const { svc } = setup(Array.from({ length: 5 }, () => new HttpError("boom", 503)));
    await expect(svc.generateJson(req())).rejects.toThrow(/after 4 attempts/);
  });

  it("does not retry 400 errors", async () => {
    const { svc, transport } = setup([new HttpError("bad schema", 400), ok({ answer: 1 })]);
    await expect(svc.generateJson(req())).rejects.toBeInstanceOf(FatalError);
    expect(transport.requests).toHaveLength(1);
  });

  it("repairs schema-invalid output once, sending the problems back", async () => {
    const { svc, transport, store } = setup([{ text: "```json\n{\"answer\": \"x\"}\n```" }, ok({ answer: 3 })]);
    const r = await svc.generateJson(req());
    expect(r.data.answer).toBe(3);
    expect(transport.requests).toHaveLength(2);
    const repair = transport.requests[1]?.parts.at(-1);
    expect(repair?.kind === "text" && repair.text).toContain("answer");
    expect(store.calls.some((c) => c.status === "schema_invalid")).toBe(true);
    expect(store.cache.size).toBe(1);
  });

  it("fails with SchemaInvalidError when the repair is also invalid and caches nothing", async () => {
    const { svc, store } = setup([{ text: "not json" }, { text: "{}" }]);
    await expect(svc.generateJson(req())).rejects.toBeInstanceOf(SchemaInvalidError);
    expect(store.cache.size).toBe(0);
  });

  it("falls back to the next model when the first is out of quota, then reports exhaustion", async () => {
    const day = () => pacificDay(Date.UTC(2026, 10, 7, 20));
    const a = setup([ok({ answer: 4 })], { flash: 0, "flash-lite": 500, embed: 10 });
    const r = await a.svc.generateJson(req({ task: "plan" }));
    expect(r.model).toBe("flash-lite");
    expect(a.transport.requests[0]?.model).toBe("flash-lite");
    expect(a.store.calls[0]?.status).toBe("quota_blocked");
    expect(a.store.events.some((e) => e.type === "quota_exhausted")).toBe(true);
    expect(day()).toMatch(/^2026-11-07$/);

    const b = setup([ok({ answer: 5 })], { flash: 0, "flash-lite": 0, embed: 10 });
    await expect(b.svc.generateJson(req({ task: "plan" }))).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(b.transport.requests).toHaveLength(0);
  });

  it("never lets the panel fall back to another model", async () => {
    const { svc, transport } = setup([ok({ answer: 1 })], { flash: 20, "flash-lite": 0, embed: 10 });
    await expect(svc.generateJson(req({ task: "panel" }))).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(transport.requests).toHaveLength(0);
    expect(modelChain("panel", models)).toEqual(["flash-lite"]);
    expect(modelChain("plan", models)).toEqual(["flash", "flash-lite"]);
  });

  it("warns at 70% and 90% of the daily budget, once each", async () => {
    const { svc, store } = setup(Array.from({ length: 10 }, (_, i) => ok({ answer: i })), { flash: 20, "flash-lite": 10, embed: 10 });
    for (let i = 0; i < 10; i++) await svc.generateJson(req({ cacheKeyExtra: { i } }));
    const warnings = store.events.filter((e) => e.type === "quota_warning");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.payload["used"]).toBe(7);
    expect(warnings[1]?.payload["used"]).toBe(9);
  });

  it("sends the schema without $schema and never sends a temperature or minimal thinking to 3.8", async () => {
    const { svc, transport } = setup([ok({ answer: 1 })]);
    await svc.generateJson(req());
    const sent = transport.requests[0];
    expect(sent?.schemaJson["$schema"]).toBeUndefined();
    expect(sent).not.toHaveProperty("temperature");
    expect(thinkingLevel("detect", "gemini-3.8-flash")).toBe("low");
    expect(thinkingLevel("detect", "gemini-3.5-flash-lite")).toBe("minimal");
    expect(thinkingLevel("plan", "unknown-model")).toBeUndefined();
  });

  it("embeds, normalizes and caches; rejects wrong dimensions", async () => {
    const { svc, transport } = setup([]);
    const a = await svc.embedImage({ png: new Uint8Array([1]), sha256: "abc" });
    expect(a.vector[0]).toBeCloseTo(0.6, 6);
    expect(a.vector[1]).toBeCloseTo(0.8, 6);
    const b = await svc.embedImage({ png: new Uint8Array([1]), sha256: "abc" });
    expect(b.cacheHit).toBe(true);
    expect(transport.embedCalls).toBe(1);
    const bad = new ScriptedTransport([], [1, 2, 3]);
    const svc2 = new LlmService({ models, embedDims: 768, rpd: { embed: 5 }, safetyMargin: 1, limiter: new RateLimiter({ embed: 10 }, 1, new FakeClock()), transport: bad, store: new MemoryLlmStore(), clock: new FakeClock() });
    await expect(svc2.embedImage({ png: new Uint8Array([1]), sha256: "x" })).rejects.toBeInstanceOf(FatalError);
  });
});

describe("cache key", () => {
  it("is stable, and changes with model, prompt version and extras", () => {
    const base = cacheKey("m", req());
    expect(cacheKey("m", req())).toBe(base);
    expect(cacheKey("m2", req())).not.toBe(base);
    expect(cacheKey("m", req({ promptVersion: "panel@2" }))).not.toBe(base);
    expect(cacheKey("m", req({ cacheKeyExtra: { personas: "a,b" } }))).not.toBe(base);
    expect(cacheKey("m", req({ parts: [{ kind: "image", png: new Uint8Array(), sha256: "s1" }] }))).not.toBe(
      cacheKey("m", req({ parts: [{ kind: "image", png: new Uint8Array(), sha256: "s2" }] })),
    );
  });
  it("produces a flat JSON schema", () => {
    expect(schemaToJson(Out)).toMatchObject({ type: "object", properties: { answer: { type: "number" } } });
  });
});

describe("RateLimiter", () => {
  it("spends the burst, then waits for refill", async () => {
    const clock = new FakeClock();
    const l = new RateLimiter({ m: 10 }, 0.5, clock);
    for (let i = 0; i < 5; i++) await l.acquire("m");
    expect(clock.sleeps).toEqual([]);
    await l.acquire("m");
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(11_000);
  });
  it("honours a cool-down and rejects unknown models", async () => {
    const clock = new FakeClock();
    const l = new RateLimiter({ m: 10 }, 1, clock);
    l.coolDown("m", 5000);
    await l.acquire("m");
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5000);
    expect(l.has("zzz")).toBe(false);
    await expect(l.acquire("zzz")).rejects.toThrow();
  });
});

describe("misc LLM helpers", () => {
  it("parses a retry delay from error text", () => {
    expect(retryDelayMs('... "retryDelay": "34s" ...')).toBe(34000);
    expect(retryDelayMs("Please retry in 2.5s")).toBe(2500);
    expect(retryDelayMs("nothing here")).toBeUndefined();
  });
  it("FakeLlmClient scripts outcomes and validates them", async () => {
    const fake = new FakeLlmClient([{ task: "panel", respond: [{ answer: "bad" }, { answer: 1 }] }]);
    await expect(fake.generateJson(req())).rejects.toThrow();
    expect((await fake.generateJson(req())).data.answer).toBe(1);
    await expect(fake.generateJson(req({ task: "detect" }))).rejects.toThrow(/no handler/);
    const err = new FakeLlmClient([{ task: "panel", respond: [new HttpError("x", 429)] }]);
    await expect(err.generateJson(req())).rejects.toBeInstanceOf(HttpError);
    expect((await fake.embedImage({ png: new Uint8Array(), sha256: "s" })).vector).toHaveLength(768);
  });
});
