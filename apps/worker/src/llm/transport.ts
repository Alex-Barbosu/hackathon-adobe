import type { Part } from "./client.ts";

export interface GenerateRequest {
  model: string;
  system: string;
  parts: Part[];
  schemaJson: Record<string, unknown>;
  thinkingLevel: string | undefined;
  timeoutMs: number;
}

export interface GenerateResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface EmbedTransportRequest {
  model: string;
  png: Uint8Array;
  dims: number;
}

// The only provider-specific seam. gemini.ts implements it; tests script it.
export interface Transport {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  embed(req: EmbedTransportRequest): Promise<number[]>;
  listModels(): Promise<string[]>;
}
