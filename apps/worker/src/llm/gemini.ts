import { GoogleGenAI } from "@google/genai";
import { HttpError } from "../errors.ts";
import type { Part } from "./client.ts";
import type { EmbedTransportRequest, GenerateRequest, GenerateResponse, Transport } from "./transport.ts";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type InputItem = { type: "text"; text: string } | { type: "image"; data: string; mime_type: "image/png" };

function toInput(parts: readonly Part[]): InputItem[] {
  return parts.flatMap((p): InputItem[] => {
    if (p.kind === "text") return [{ type: "text", text: p.text }];
    const image: InputItem = { type: "image", data: toBase64(p.png), mime_type: "image/png" };
    return p.label ? [{ type: "text", text: p.label }, image] : [image];
  });
}

function statusOf(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;
  for (const k of ["status", "statusCode", "code"] as const) {
    const v = (err as Record<string, unknown>)[k];
    if (typeof v === "number" && v >= 100 && v < 600) return v;
  }
  const m = /\b(4\d\d|5\d\d)\b/.exec(err instanceof Error ? err.message : "");
  return m?.[1] ? Number(m[1]) : 0;
}

// The docs show no machine-readable retry delay for Interactions, so read it from the message if present.
export function retryDelayMs(message: string): number | undefined {
  const m = /retry(?:Delay)?["']?[^0-9]{0,20}(\d+(?:\.\d+)?)\s*s/i.exec(message);
  return m?.[1] ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export class GeminiTransport implements Transport {
  private readonly client: GoogleGenAI;

  constructor(private readonly apiKey: string) {
    // Tests must never reach the real API.
    if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) {
      throw new Error("GeminiTransport refuses to run under test; use the fake client");
    }
    // Image inputs on Interactions are only accepted on v1beta (the SDK defaults to v1; verified against the live API).
    this.client = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  }

  private toError(err: unknown): HttpError {
    const message = redact(err instanceof Error ? err.message : String(err), this.apiKey);
    const status = statusOf(err);
    return new HttpError(message, status, retryDelayMs(message));
  }

  private async withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new HttpError(`Request timed out after ${ms} ms`, 408));
      }, ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    try {
      const interaction = await this.withTimeout(
        this.client.interactions.create({
          model: req.model,
          input: toInput(req.parts),
          system_instruction: req.system,
          ...(req.thinkingLevel ? { generation_config: { thinking_level: req.thinkingLevel } } : {}),
          response_format: { type: "text", mime_type: "application/json", schema: req.schemaJson },
          // Stateless: ad content is not retained server-side.
          store: false,
        }),
        req.timeoutMs,
      );
      const usage = interaction.usage;
      return {
        text: interaction.output_text ?? "",
        ...(usage ? { usage: { inputTokens: usage.total_input_tokens ?? 0, outputTokens: usage.total_output_tokens ?? 0 } } : {}),
      };
    } catch (err) {
      throw err instanceof HttpError ? err : this.toError(err);
    }
  }

  async embed(req: EmbedTransportRequest): Promise<number[]> {
    try {
      const res = await this.client.models.embedContent({
        model: req.model,
        contents: [{ inlineData: { mimeType: "image/png", data: toBase64(req.png) } }],
        config: { outputDimensionality: req.dims },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values) throw new HttpError("Embedding response had no values", 502);
      return values;
    } catch (err) {
      throw err instanceof HttpError ? err : this.toError(err);
    }
  }

  async listModels(): Promise<string[]> {
    const names: string[] = [];
    for await (const m of await this.client.models.list()) {
      if (m.name) names.push(m.name.replace(/^models\//, ""));
    }
    return names;
  }
}
