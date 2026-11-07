// Verifies the Cloudflare image edit call against your real account: edits a synthetic crop and writes
// tmp/cf-before.png and tmp/cf-after.png. This is where the (undocumented) FLUX.2 multipart field names
// get confirmed; if Cloudflare rejects them, adjust FLUX_FIELDS in apps/worker/src/image/generative.ts.
import { mkdir, writeFile } from "node:fs/promises";
import { CloudflareImageEditor, DEFAULT_CLOUDFLARE_IMAGE_MODEL } from "../apps/worker/src/image/generative.ts";
import { syntheticAd } from "../apps/worker/src/image/synthetic.ts";
import { crop } from "../apps/worker/src/image/raster.ts";
import { encodePng } from "../apps/worker/src/image/raster.ts";
import { toPixels } from "@nologo/core";
import { env } from "./lib.ts";

const e = env(true);
if (!e.CLOUDFLARE_ACCOUNT_ID || !e.CLOUDFLARE_API_TOKEN) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env");
const model = e.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
const ad = syntheticAd({ size: 512, background: [240, 230, 200], border: [20, 60, 120], logo: [200, 30, 30], mascot: [250, 200, 0], product: [30, 140, 60], text: [40, 40, 40] });
const mascot = ad.regions.find((r) => r.kind === "mascot_character");
if (!mascot) throw new Error("no mascot region");
const patch = crop(ad.raster, toPixels(mascot.box, 512, 512));
const before = await encodePng(patch);
const editor = new CloudflareImageEditor({ accountId: e.CLOUDFLARE_ACCOUNT_ID, apiToken: e.CLOUDFLARE_API_TOKEN, model });
const started = Date.now();
const after = await editor.edit({ png: before, instruction: "a cheerful round blue character with big eyes", width: patch.width, height: patch.height, seed: 1 });
await mkdir("tmp", { recursive: true });
await writeFile("tmp/cf-before.png", before);
await writeFile("tmp/cf-after.png", after);
console.log(`${model}: ${after.length} bytes in ${Date.now() - started} ms -> tmp/cf-after.png`);
