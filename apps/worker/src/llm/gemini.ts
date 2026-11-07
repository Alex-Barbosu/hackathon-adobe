import { GoogleGenAI } from "@google/genai";
import { HttpError } from "../errors.ts";
import type { Part } from "./client.ts";
import type { EmbedTransportRequest, GenerateRequest, GenerateResponse, Transport } from "./transport.ts";

// Wire/strict split. Gemini compiles the response schema into a state machine and rejects large ones
// ("too many states for serving"). Every constraint that adds states is removed from what we SEND; the full
// zod schema still validates what comes BACK (service.ts), and the repair round fixes violations.
const STRIPPED_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "uniqueItems",
]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// A union whose every branch is an object with a constant on the same key (zod's discriminatedUnion) becomes
// ONE object: that key as an enum, every other field optional. The branch-specific rules are left to zod.
function flattenDiscriminated(branches: Json[]): Json | null {
  if (!branches.every((b) => b["type"] === "object" && isObj(b["properties"]))) return null;
  const first = branches[0];
  const props = (b: Json): Json => b["properties"] as Json;
  const disc = Object.keys(first ? props(first) : {}).find((k) =>
    branches.every((b) => isObj(props(b)[k]) && "const" in (props(b)[k] as Json)),
  );
  if (!disc) return null;
  const merged: Json = {};
  const usedBy = new Map<string, string[]>();
  const values: unknown[] = [];
  const guide: string[] = [];
  for (const b of branches) {
    const name = String((props(b)[disc] as Json)["const"]);
    const required = Array.isArray(b["required"]) ? (b["required"] as string[]).filter((k) => k !== disc) : [];
    values.push(name);
    guide.push(`${name}: ${required.join(", ") || "(no other fields)"}`);
    for (const [k, v] of Object.entries(props(b))) {
      if (k === disc) continue;
      usedBy.set(k, [...(usedBy.get(k) ?? []), name]);
      if (!(k in merged)) merged[k] = v;
    }
  }
  // Fields are optional on the wire, so say which ones each variant needs: without this the model omits them
  // (seen live: tone without contrast, add_band without hex). Descriptions add no states to the grammar.
  for (const [k, v] of Object.entries(merged)) {
    const base = isObj(v) && typeof v["description"] === "string" ? `${v["description"]} ` : "";
    merged[k] = { ...(isObj(v) ? v : {}), description: `${base}(used by: ${(usedBy.get(k) ?? []).join(", ")})` };
  }
  const discProp = {
    type: "string",
    enum: values,
    description: `Which ${disc}. EVERY field listed for the chosen ${disc} is REQUIRED; never omit one. Required fields per ${disc}: ${guide.join("; ")}.`,
  };
  return { type: "object", properties: { [disc]: discProp, ...merged }, required: [disc], additionalProperties: false };
}

// T | null unions collapse to a type array, which the structured-output subset supports.
function collapseNullable(branches: Json[]): Json | null {
  if (branches.length !== 2) return null;
  const nul = branches.find((b) => b["type"] === "null");
  const other = branches.find((b) => b !== nul);
  if (!nul || !other || typeof other["type"] !== "string") return null;
  return { ...other, type: [other["type"], "null"] };
}

function wire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(wire);
  if (!isObj(node)) return node;
  const union = (node["anyOf"] ?? node["oneOf"]);
  if (Array.isArray(union)) {
    const branches = union.filter(isObj);
    const flat = flattenDiscriminated(branches) ?? collapseNullable(branches);
    // Failing loudly at build time beats a 400 from the API at run time.
    if (!flat) throw new Error("toWireSchema: unsupported union; model it as a flat object or an enum");
    const { anyOf: _a, oneOf: _o, ...rest } = node;
    return wire({ ...rest, ...flat });
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_KEYS.has(key)) continue;
    // Keys under "properties" are field names, not keywords: keep them and recurse into the values.
    out[key] = key === "properties" && isObj(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) : wire(value);
  }
  return out;
}

export function toWireSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = wire(schema);
  if (!isObj(result)) throw new Error("toWireSchema: schema must be an object");
  return result;
}

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
          response_format: { type: "text", mime_type: "application/json", schema: toWireSchema(req.schemaJson) },
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
