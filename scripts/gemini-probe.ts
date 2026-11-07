// Diagnostic: one tiny text-only Interactions call per configured model, printing status and error text.
import { GoogleGenAI } from "@google/genai";
import { env } from "./lib.ts";

const e = env(true);
const client = new GoogleGenAI({ apiKey: e.GEMINI_API_KEY, apiVersion: "v1beta" });
for (const model of [e.MODEL_DETECT, e.MODEL_PLAN]) {
  try {
    const r = await client.interactions.create({ model, input: "Reply with the single word: ok", store: false });
    console.log(model, "->", JSON.stringify(r.output_text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(model, "-> ERROR", msg.replaceAll(e.GEMINI_API_KEY, "[redacted]").slice(0, 500));
    if (typeof err === "object" && err !== null) console.log("  fields:", Object.keys(err).join(","), JSON.stringify((err as Record<string, unknown>)["body"] ?? "").slice(0, 400));
  }
}
