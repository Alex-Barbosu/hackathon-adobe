import { createHash } from "node:crypto";
import sharp from "sharp";
import { l2Normalize, mulberry32, hashString, type DetectedRegion } from "@nologo/core";
import { templateReport, type ReportData } from "../pipeline/reportdata.ts";
import type { EmbedRequest, EmbedResult, JsonRequest, LlmClient, LlmResult, Part } from "./client.ts";

// OFFLINE STAND-IN for Gemini, used by scripts and demos when no API key or quota is available.
// The "panel" is a deterministic colour-layout matcher over 8x8 thumbnails, NOT a language model:
// removing a distinctive element really does change what it matches, so the pipeline produces
// meaningful numbers, but they say nothing about real viewers.

async function thumb(png: Uint8Array): Promise<number[]> {
  const raw = await sharp(png).resize(8, 8, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return Array.from(raw);
}

const dist = (a: number[], b: number[]): number => Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] ?? 0)) ** 2, 0) / a.length) / 255;

const textOf = (parts: Part[]): string => parts.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("\n");

export interface SimulatedOptions {
  // Known geometry for synthetic ads, keyed by the sha256 of the normalized PNG.
  oracle: (sha256: string) => DetectedRegion[] | undefined;
  dims?: number;
}

export class SimulatedLlm implements LlmClient {
  constructor(private readonly o: SimulatedOptions) {}

  async generateJson<T>(req: JsonRequest<T>): Promise<LlmResult<T>> {
    const out = await this.answer(req);
    return { data: req.schema.parse(out), model: "simulated", cacheHit: false };
  }

  private async answer<T>(req: JsonRequest<T>): Promise<unknown> {
    const text = textOf(req.parts);
    switch (req.task) {
      case "detect": {
        const img = req.parts.find((p) => p.kind === "image");
        const regions = img?.kind === "image" ? this.o.oracle(img.sha256) ?? [] : [];
        return { regions: regions.map((r) => ({ kind: r.kind, label: r.label, box_2d: [...r.box], confidence: 0.95 })) };
      }
      case "leak_check":
        return { leaks: [] };
      case "panel":
        return this.panel(req.parts, text);
      case "quiz_bank": {
        const findings = JSON.parse(/Findings \(JSON\):\n(.*)/.exec(text)?.[1] ?? "[]") as Array<{ findingKey: string; rule: string; element: string | null; competitorName: string | null }>;
        const questions = findings.flatMap((f) => {
          if (f.rule === "traitor" && f.element) {
            return [{ finding_key: f.findingKey, slot: `traitor_policy:${f.element}`, type: "single_choice", prompt: `Your ${f.element} pulls viewers toward ${f.competitorName ?? "a competitor"}. What should we do?`, options: ["keep", "replace", "remove"].map((v) => ({ value: v, label: v })) }];
          }
          if (f.rule === "strong_asset" && f.element) {
            return [{ finding_key: f.findingKey, slot: `asset_emphasis:${f.element}`, type: "slider", prompt: `Your ${f.element} carries the brand. How hard should we lean on it?`, options: [], slider: { min: 1, max: 5, min_label: "Lightly", max_label: "Heavily" } }];
          }
          return [];
        });
        return { questions: questions.slice(0, 4) };
      }
      case "directions":
        return {
          directions: [
            ["Hero the mascot", "Make the character larger.", ["amplify_mascot"]],
            ["Own one colour", "Commit to a single signature colour.", ["own_a_color"]],
            ["Break the colour code", "Move away from the rival's colour.", ["neutralise_traitor_color"]],
            ["Frame it", "Add a recognisable frame.", ["brand_band_or_frame"]],
            ["Quiet and spacious", "More whitespace, calmer layout.", ["more_whitespace", "quieter_typography"]],
            ["Product first", "Push the product forward.", ["amplify_product"]],
          ].map(([title, description, tags]) => ({ title, description, tags })),
        };
      case "plan":
      case "plan_repair": {
        const lines = [...text.matchAll(/^(R\d+): (\w+) .* locked: (yes|no)$/gm)].map((m) => ({ ref: m[1] ?? "", kind: m[2] ?? "", locked: m[3] === "yes" }));
        const pick = (kind: string): string | undefined => lines.find((l) => l.kind === kind && !l.locked)?.ref;
        const any = lines.find((l) => !l.locked)?.ref ?? "R1";
        const a = pick("mascot_character") ?? any;
        const b = pick("product") ?? any;
        return {
          plans: [
            { title: "Larger hero", hypothesis: "Enlarging the main character should raise attribution.", primaryElement: "mascot_character", directionTags: ["amplify_mascot"], ops: [{ op: "scale_region", regionId: a, factor: 1.15, anchor: "center" }] },
            { title: "Shift the hero", hypothesis: "Repositioning the character should make the layout more distinctive.", primaryElement: "layout", directionTags: [], ops: [{ op: "move_region", regionId: a, dxPct: 4, dyPct: -3 }] },
            { title: "Smaller product", hypothesis: "Shrinking the product gives the brand cues more weight.", primaryElement: "product", directionTags: ["amplify_mascot"], ops: [{ op: "scale_region", regionId: b, factor: 0.85, anchor: "center" }] },
          ],
        };
      }
      case "brand_fit":
        return {
          versions: req.parts
            .flatMap((p) => (p.kind === "image" && /^V\d+:/.test(p.label ?? "") ? [(p.label ?? "").replace(":", "")] : []))
            .map((version) => ({ version, tone_match: 4, taboo_violations: [], mandatory_copy_ok: true, note: "Simulated check." })),
        };
      case "report": {
        const data = JSON.parse(/Report data \(JSON\):\n([\s\S]*?)(\nYour previous|$)/.exec(text)?.[1] ?? "{}") as ReportData;
        return { markdown: templateReport(data) };
      }
    }
  }

  private async panel(parts: Part[], text: string): Promise<unknown> {
    const images = parts.filter((p): p is Extract<Part, { kind: "image" }> => p.kind === "image");
    const test = images.at(-1);
    const exposures = images.slice(0, -1);
    const candidates = [...text.matchAll(/^([A-Z]): (.+)$/gm)].map((m) => ({ letter: m[1] ?? "", name: m[2] ?? "" }));
    const people = [...text.matchAll(/^(P\d+): .*\(viewing: (\w+); familiarity: (\w+)\)$/gm)];
    const labelsOf = (p: Part): string => (p.kind === "image" ? p.label ?? "" : "");
    const tTest = test ? await thumb(test.png) : [];
    const byBrand = new Map<string, number[][]>();
    for (const e of exposures) {
      const brand = /brand: (.+)$/.exec(labelsOf(e))?.[1] ?? "";
      byBrand.set(brand, [...(byBrand.get(brand) ?? []), await thumb(e.png)]);
    }
    const seedBase = hashString(test?.sha256 ?? "x");
    return {
      people: people.map((m, idx) => {
        const rng = mulberry32(seedBase ^ hashString(`${m[1]}${idx}`));
        const glance = m[2] === "glance";
        const fam = m[3] ?? "light";
        const tau = glance ? 0.16 : 0.08;
        const raw = candidates.map((c) => {
          if (c.name === "none of these") return { letter: c.letter, w: fam === "none" ? 0.6 : fam === "light" ? 0.25 : 0.1 };
          const th = byBrand.get(c.name) ?? [];
          const d = th.length === 0 ? 0.5 : Math.min(...th.map((t) => dist(tTest, t)));
          return { letter: c.letter, w: Math.exp(-d / tau) * (0.8 + 0.4 * rng()) };
        });
        const sum = raw.reduce((s, r) => s + r.w, 0) || 1;
        const cues = [{ element: "color", text: "colour palette" }, ...(rng() < 0.7 ? [{ element: "mascot_character", text: "character" }] : []), ...(rng() < 0.3 ? [{ element: "product", text: "pack shape" }] : [])];
        return {
          person: m[1] ?? "",
          scores: raw.map((r) => ({ candidate: r.letter, probability: Math.round((r.w / sum) * 1000) / 1000 })),
          cues,
          saw_identifier: false,
        };
      }),
    };
  }

  embedImage(req: EmbedRequest): Promise<EmbedResult> {
    return thumb(req.png).then((t) => {
      const dims = this.o.dims ?? 768;
      const salt = createHash("sha256").update(req.sha256).digest();
      const raw = Array.from({ length: dims }, (_, i) => (t[i % t.length] ?? 0) / 255 - 0.5 + ((salt[i % salt.length] ?? 0) / 255 - 0.5) * 0.02);
      return { vector: l2Normalize(raw), model: "simulated-embed", cacheHit: false };
    });
  }
}
