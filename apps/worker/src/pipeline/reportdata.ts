// Every number the report may mention is formatted here, once, from stored metrics. The model only
// rephrases; a post-check verifies that each number it wrote came from this data.

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const pctRange = (ci: readonly [number, number]): string => `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%`;
export const points = (x: number): string => `${Math.abs(Math.round(x * 100))} points`;
export const direction = (x: number): "higher" | "lower" | "unchanged" =>
  Math.round(x * 100) > 0 ? "higher" : Math.round(x * 100) < 0 ? "lower" : "unchanged";

export interface ReportData {
  notice: string;
  target: { brand: string; attribution: string; interval: string; votes: number; batches: number };
  control: { attribution: string } | null;
  elements: Array<{ element: string; label: string; change: string; direction: string; interval: string }>;
  findings: Array<{ rule: string; element: string | null; brand: string | null; severity: number; summary: string }>;
  similarity: { percentile: string; nearestBrand: string | null } | null;
  quiz: { changeBudget: number; colorFreedom: string; competitorToEscape: string | null; ownableRanked: string[]; topDirections: string[] } | null;
  variants: Array<{
    name: string;
    title: string;
    hypothesis: string;
    status: string;
    changedPixels: string | null;
    attributionChange: string | null;
    attributionDirection: string | null;
    interval: string | null;
    similarityChange: string | null;
    brandFit: string;
    wins: boolean;
  }>;
  caveats: string[];
}

// Numbers are compared as tokens: "31%" and "31" both count as the token 31.
const NUMBER = /\d+(?:[.,]\d+)?/g;

export function numberTokens(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((t) => t.replace(",", "."));
}

export interface NumberCheck {
  offending: string[];
  checked: number;
}

export function checkNumbers(markdown: string, data: ReportData): NumberCheck {
  const allowed = new Set(numberTokens(JSON.stringify(data)));
  // Ordinals at the start of a list line ("1. ") are formatting, not claims.
  const cleaned = markdown.replace(/^\s*\d+[.)]\s/gm, "");
  const used = numberTokens(cleaned);
  return { offending: [...new Set(used.filter((t) => !allowed.has(t)))], checked: used.length };
}

// Used when the report model is unavailable: same data, no model, so a demo never ends without a report.
export function templateReport(d: ReportData): string {
  const lines: string[] = [];
  lines.push(
    `**Verdict.** With its brand marks hidden, an ad from ${d.target.brand} was attributed to ${d.target.brand} by ${d.target.attribution} of the simulated panel (interval ${d.target.interval}, ${d.target.votes} simulated viewers across ${d.target.batches} calls).`,
  );
  if (d.control) lines.push(`Viewers with no prior exposure still picked ${d.target.brand} ${d.control.attribution} of the time.`);
  const carries = d.elements.filter((e) => e.label === "strong_asset");
  const betrays = d.elements.filter((e) => e.label === "traitor");
  lines.push(`\n**What carries the brand.** ${carries.length === 0 ? "No single element clearly carries the brand." : carries.map((e) => `${e.element} (removing it makes attribution ${e.direction === "higher" ? "lower" : "higher"} by ${e.change})`).join("; ")}.`);
  lines.push(`\n**What betrays it.** ${betrays.length === 0 ? "No element was found pulling viewers toward one competitor." : betrays.map((e) => e.element).join(", ")}.`);
  if (d.similarity) lines.push(`\n**Category.** The ad sits at the ${d.similarity.percentile} point of closeness to the category average${d.similarity.nearestBrand ? `; its nearest look-alike is ${d.similarity.nearestBrand}` : ""}.`);
  if (d.variants.length > 0) {
    lines.push("\n**Variants.**");
    for (const v of d.variants) {
      lines.push(`- ${v.name} (${v.title}): ${v.status}${v.attributionChange ? `, attribution ${v.attributionDirection} by ${v.attributionChange} (interval ${v.interval})` : ""}; brand fit: ${v.brandFit}.`);
    }
  }
  lines.push(`\n**Caveats.** ${d.caveats.join(" ")}`);
  return lines.join("\n");
}
