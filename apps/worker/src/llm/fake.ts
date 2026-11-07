import { createHash } from "node:crypto";
import { l2Normalize } from "@nologo/core";
import type { EmbedRequest, EmbedResult, JsonRequest, LlmClient, LlmResult, Task } from "./client.ts";

export type Outcome<T = unknown> = T | Error;

export interface Handler {
  task: Task;
  // First matching handler wins; omit to match every request for the task.
  match?: (req: JsonRequest<unknown>) => boolean;
  // A function computes the answer from the request; an array is consumed one outcome per call
  // (the last one repeats), which scripts failures like "invalid output, then valid".
  respond: ((req: JsonRequest<unknown>) => Outcome) | Outcome[];
}

// Fixture-backed LlmClient for tests and offline runs. Never touches the network.
export class FakeLlmClient implements LlmClient {
  readonly calls: Array<{ task: Task; promptVersion: string }> = [];
  private readonly cursor = new Map<Handler, number>();

  constructor(
    private readonly handlers: Handler[],
    private readonly dims = 768,
  ) {}

  generateJson<T>(req: JsonRequest<T>): Promise<LlmResult<T>> {
    this.calls.push({ task: req.task, promptVersion: req.promptVersion });
    const handler = this.handlers.find((h) => h.task === req.task && (h.match?.(req) ?? true));
    if (!handler) return Promise.reject(new Error(`FakeLlmClient: no handler for task ${req.task}`));
    let outcome: Outcome;
    if (typeof handler.respond === "function") {
      try {
        outcome = handler.respond(req);
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    else {
      const i = this.cursor.get(handler) ?? 0;
      this.cursor.set(handler, i + 1);
      outcome = handler.respond[Math.min(i, handler.respond.length - 1)];
    }
    if (outcome instanceof Error) return Promise.reject(outcome);
    // Same validation a real answer would get, so a bad fixture fails loudly.
    const parsed = req.schema.safeParse(outcome);
    if (!parsed.success) return Promise.reject(parsed.error);
    return Promise.resolve({ data: parsed.data, model: "fake", cacheHit: false });
  }

  embedImage(req: EmbedRequest): Promise<EmbedResult> {
    // Deterministic pseudo-embedding from the image hash.
    const digest = createHash("sha256").update(req.sha256).digest();
    const raw = Array.from({ length: this.dims }, (_, i) => (digest[i % digest.length] ?? 0) - 127.5 + Math.sin(i));
    return Promise.resolve({ vector: l2Normalize(raw), model: "fake-embed", cacheHit: false });
  }
}
