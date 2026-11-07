import { describe, expect, it } from "vitest";
import { editDslSpec, norm, toPixels, validatePlan, compileBrief, emptyDraft, type EditPlanValue, type Rgb } from "@nologo/core";
import { HttpError } from "../errors.ts";
import { changedWithin } from "./guard.ts";
import { CloudflareImageEditor, type ImageEditor } from "./generative.ts";
import { decodePng, encodePng, newRaster, pixelAt, type Raster } from "./raster.ts";
import { renderPlan, type RenderRegion } from "./render.ts";

const BLUE: Rgb = [10, 30, 220];
const regions: RenderRegion[] = [
  { ref: "R1", kind: "logo", box: norm(50, 50, 150, 250), locked: true, isIdentifier: true },
  { ref: "R2", kind: "mascot_character", box: norm(400, 100, 700, 400), locked: false, isIdentifier: false },
];
const plan = (instruction = "a friendly blue robot"): EditPlanValue => ({
  title: "t",
  hypothesis: "h",
  primaryElement: "mascot_character",
  directionTags: [],
  ops: [{ op: "generative_inpaint", regionId: "R2", instruction }],
});

// A fake model: returns an all-blue image of a different size than the crop, like a real one might.
class FakeEditor implements ImageEditor {
  readonly requests: Array<{ instruction: string; width: number; height: number }> = [];
  async edit(req: Parameters<ImageEditor["edit"]>[0]): Promise<Uint8Array> {
    this.requests.push({ instruction: req.instruction, width: req.width, height: req.height });
    return encodePng(newRaster(64, 64, BLUE));
  }
}

describe("generative_inpaint rendering", () => {
  const original: Raster = newRaster(400, 400, [240, 230, 200]);

  it("changes only the region and leaves everything else untouched", async () => {
    const editor = new FakeEditor();
    const { raster, protectedBoxes } = await renderPlan(original, plan(), regions, 1, editor);
    const [y0, x0, y1, x1] = toPixels(regions[1]!.box, 400, 400);
    expect(pixelAt(raster, Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2))).toEqual(BLUE);
    expect(pixelAt(raster, 5, 5)).toEqual([240, 230, 200]);
    expect(pixelAt(raster, x1 + 3, y1 + 3)).toEqual([240, 230, 200]);
    expect(changedWithin(original, raster, protectedBoxes)).toBe(0);
    expect(editor.requests[0]).toEqual({ instruction: "a friendly blue robot", width: x1 - x0, height: y1 - y0 });
  });

  it("refuses to render without an editor", async () => {
    await expect(renderPlan(original, plan(), regions, 1)).rejects.toThrow(/image editor/);
  });
});

describe("planner validation", () => {
  const { brief } = compileBrief({ ...emptyDraft(), fields: { colorFreedom: "open" } }, { identifierRegionIds: [], directionPreferences: [], topDirectionIds: [] });
  const pregions = regions.map((r) => ({ ...r }));

  it("rejects generative ops unless enabled, and accepts them when enabled", () => {
    expect(validatePlan(plan(), { regions: pregions, brief, escapeColors: [] }).join()).toContain("not enabled");
    expect(validatePlan(plan(), { regions: pregions, brief, escapeColors: [], generativeEnabled: true })).toEqual([]);
  });
  it("rejects instructions that ask for logos and ops on locked regions", () => {
    const bad = validatePlan(plan("add our logo"), { regions: pregions, brief, escapeColors: [], generativeEnabled: true });
    expect(bad.join()).toContain("logo");
    const locked: EditPlanValue = { ...plan(), ops: [{ op: "generative_inpaint", regionId: "R1", instruction: "make it purple" }] };
    expect(validatePlan(locked, { regions: pregions, brief, escapeColors: [], generativeEnabled: true }).join()).toContain("locked");
  });
  it("hides the op from the planner spec unless enabled", () => {
    expect(editDslSpec()).not.toContain("generative_inpaint");
    expect(editDslSpec(true)).toContain("generative_inpaint");
  });
});

describe("CloudflareImageEditor", () => {
  const crop = new Uint8Array([1, 2, 3]);
  const base = { accountId: "acc", apiToken: "secret-token" };
  const req = { png: crop, instruction: "make it blue", width: 300, height: 300, seed: 5 };

  it("sends FLUX multipart with the bearer token and decodes the base64 image", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const png = await encodePng(newRaster(8, 8, BLUE));
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(Response.json({ result: { image: Buffer.from(png).toString("base64") }, success: true }));
    }) as unknown as typeof fetch;
    const out = await new CloudflareImageEditor({ ...base, model: "@cf/black-forest-labs/flux-2-klein-4b", fetchImpl }).edit(req);
    expect(pixelAt(await decodePng(out), 0, 0)).toEqual(BLUE);
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-2-klein-4b");
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-token");
    const form = calls[0]?.init.body as FormData;
    expect(form.get("prompt")).toContain("make it blue");
    expect(form.get("prompt")).toContain("Do not add any text");
    expect(form.get("input_image_0")).toBeInstanceOf(Blob);
  });

  it("sends JSON for stable-diffusion models and accepts raw PNG bytes", async () => {
    const png = await encodePng(newRaster(8, 8, BLUE));
    let body = "";
    const fetchImpl = ((_u: string, init: RequestInit) => {
      body = init.body as string;
      return Promise.resolve(new Response(png, { headers: { "content-type": "image/png" } }));
    }) as unknown as typeof fetch;
    const out = await new CloudflareImageEditor({ ...base, model: "@cf/runwayml/stable-diffusion-v1-5-inpainting", fetchImpl }).edit(req);
    expect(out.length).toBe(png.length);
    expect(JSON.parse(body)).toMatchObject({ image: [1, 2, 3], width: 300, seed: 5 });
  });

  it("maps errors to HttpError, redacting the token and marking 429 retryable by status", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("bad token secret-token", { status: 429 }))) as unknown as typeof fetch;
    const err = await new CloudflareImageEditor({ ...base, model: "m", fetchImpl }).edit(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect((err as HttpError).message).not.toContain("secret-token");
  });

  it("refuses to hit the real API under test", () => {
    expect(() => new CloudflareImageEditor({ ...base, model: "m" })).toThrow(/refuses to run under test/);
  });
});
