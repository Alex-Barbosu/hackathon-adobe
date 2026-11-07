import { HttpError } from "../errors.ts";

export interface EditRequest {
  // PNG crop of the one region to change.
  png: Uint8Array;
  instruction: string;
  width: number;
  height: number;
  seed: number;
}

// The renderer only sees this. Swapping providers touches one file.
export interface ImageEditor {
  edit(req: EditRequest): Promise<Uint8Array>;
}

export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export interface CloudflareOptions {
  accountId: string;
  apiToken: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Cloudflare documents the FLUX.2 input only as "multipart" without field names (docs checked 2026-11-07),
// so the names are constants here and `scripts/cf-smoke.ts` exercises them against a real account.
const FLUX_FIELDS = { prompt: "prompt", image: "input_image_0", width: "width", height: "height" } as const;

const NEGATIVE_PROMPT = "text, letters, logo, watermark, brand name, signature";

const toBytes = (b: string): Uint8Array => Uint8Array.from(Buffer.from(b, "base64"));

// Image edits for the `generative_inpaint` Edit DSL op, run on Cloudflare Workers AI.
export class CloudflareImageEditor implements ImageEditor {
  private readonly f: typeof fetch;

  constructor(private readonly o: CloudflareOptions) {
    // Tests must never reach the real API.
    if (!o.fetchImpl && (process.env["NODE_ENV"] === "test" || process.env["VITEST"])) {
      throw new Error("CloudflareImageEditor refuses to run under test; inject a fake fetchImpl or ImageEditor");
    }
    this.f = o.fetchImpl ?? fetch;
  }

  private url(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.o.accountId}/ai/run/${this.o.model}`;
  }

  // Wraps the user instruction so the model changes style and content, not brand marks.
  static prompt(instruction: string): string {
    return `${instruction.trim()}. Keep the same composition and framing. Do not add any text, letters, logos or brand names.`;
  }

  private requestInit(req: EditRequest): RequestInit {
    const headers = { Authorization: `Bearer ${this.o.apiToken}` };
    const prompt = CloudflareImageEditor.prompt(req.instruction);
    if (this.o.model.includes("stable-diffusion")) {
      // SD inpainting/img2img: JSON body with the image as an array of bytes (documented). A full-white mask
      // is unnecessary because the crop is the whole editable area; strength keeps the result near the input.
      return {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: NEGATIVE_PROMPT,
          image: [...req.png],
          width: Math.min(2048, Math.max(256, req.width)),
          height: Math.min(2048, Math.max(256, req.height)),
          strength: 0.7,
          num_steps: 20,
          seed: req.seed,
        }),
      };
    }
    const form = new FormData();
    form.set(FLUX_FIELDS.prompt, prompt);
    form.set(FLUX_FIELDS.image, new Blob([req.png], { type: "image/png" }), "region.png");
    form.set(FLUX_FIELDS.width, String(Math.max(256, req.width)));
    form.set(FLUX_FIELDS.height, String(Math.max(256, req.height)));
    return { method: "POST", headers, body: form };
  }

  async edit(req: EditRequest): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, this.o.timeoutMs ?? 90_000);
    try {
      const res = await this.f(this.url(), { ...this.requestInit(req), signal: controller.signal });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const text = (await res.text()).replaceAll(this.o.apiToken, "[redacted]").slice(0, 400);
        throw new HttpError(`Cloudflare image model returned ${res.status}: ${text}`, res.status);
      }
      // SD models answer with raw PNG bytes; FLUX models with { result: { image: <base64> } }.
      if (type.startsWith("image/")) return new Uint8Array(await res.arrayBuffer());
      const body = (await res.json()) as { result?: { image?: string }; success?: boolean };
      const b64 = body.result?.image;
      if (!b64) throw new HttpError("Cloudflare response had no image", 502);
      return toBytes(b64);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(err instanceof Error ? err.message : String(err), 0);
    } finally {
      clearTimeout(timer);
    }
  }
}
