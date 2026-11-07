import type { Element, Thresholds } from "./config.ts";
import type { ConditionSummary, ImpactNumbers } from "./stats.ts";

export type DiagnosisLabel = "strong_asset" | "decoration" | "traitor" | "neutral";
export type FindingRule =
  | "strong_asset"
  | "decoration"
  | "traitor"
  | "generic"
  | "known_brand"
  | "leak"
  | "misattribution";

export interface Finding {
  findingKey: string;
  rule: FindingRule;
  severity: number;
  element: Element | null;
  brandId: string | null;
  // The exact numbers that fired the rule; the report and the quiz quote these.
  evidence: Record<string, number | string | boolean | number[]>;
}

export interface ImpactInput extends ImpactNumbers {
  element: Element;
}

export interface DiagnosisInput {
  thresholds: Thresholds;
  baseline: ConditionSummary;
  controlAttribution: number | null;
  impacts: readonly ImpactInput[];
  centroidPercentile: number | null;
  leakShare: number;
}

export interface DiagnosisResult {
  findings: Finding[];
  labels: Record<string, DiagnosisLabel>;
}

const bySize = (value: number, steps: readonly [number, number, number]): number =>
  value >= steps[2] ? 5 : value >= steps[1] ? 4 : 3;

function elementRules(input: DiagnosisInput, impact: ImpactInput): Finding[] {
  const t = input.thresholds;
  const out: Finding[] = [];
  const cue = input.baseline.cueFreq[impact.element] ?? 0;
  if (impact.deltaCi[0] > t.strongAssetDeltaLow && cue >= t.strongAssetCueShare) {
    out.push({
      findingKey: `strong_asset:${impact.element}`,
      rule: "strong_asset",
      severity: bySize(impact.delta, [0.1, 0.2, 0.3]),
      element: impact.element,
      brandId: null,
      evidence: { delta: impact.delta, deltaCi: impact.deltaCi, cueShare: cue },
    });
  }
  const [lo, hi] = impact.deltaCi;
  if (Math.abs(impact.delta) < t.decorationAbsMean && lo <= 0 && hi >= 0) {
    out.push({
      findingKey: `decoration:${impact.element}`,
      rule: "decoration",
      severity: 2,
      element: impact.element,
      brandId: null,
      evidence: { delta: impact.delta, deltaCi: impact.deltaCi },
    });
  }
  // "Cuts pull toward ONE competitor": only the strongest shift can be a traitor, and its CI must exclude 0.
  const shifts = Object.entries(impact.pullShift)
    .filter(([b]) => b !== "none")
    .sort(([, a], [, b]) => b - a);
  const top = shifts[0];
  if (top && top[1] > t.traitorPullShift && (impact.pullShiftCi[top[0]]?.[0] ?? 0) > 0) {
    const without = input.baseline.pull[top[0]] ?? 0;
    out.push({
      findingKey: `traitor:${impact.element}:${top[0]}`,
      rule: "traitor",
      severity: bySize(top[1], [0.1, 0.2, 0.3]),
      element: impact.element,
      brandId: top[0],
      evidence: {
        pullShift: top[1],
        pullShiftCi: impact.pullShiftCi[top[0]] ?? [],
        pullWith: without,
        pullWithout: without - top[1],
      },
    });
  }
  return out;
}

function globalRules(input: DiagnosisInput): Finding[] {
  const t = input.thresholds;
  const out: Finding[] = [];
  if (input.centroidPercentile !== null && input.centroidPercentile >= t.genericPercentile) {
    const p = input.centroidPercentile;
    out.push({
      findingKey: "generic",
      rule: "generic",
      severity: p >= 0.95 ? 5 : p >= 0.85 ? 4 : 3,
      element: null,
      brandId: null,
      evidence: { centroidPercentile: p },
    });
  }
  if (input.controlAttribution !== null && input.controlAttribution >= t.knownBrandControl) {
    out.push({
      findingKey: "known_brand",
      rule: "known_brand",
      severity: 2,
      element: null,
      brandId: null,
      evidence: { controlAttribution: input.controlAttribution },
    });
  }
  if (input.leakShare > t.leakShare) {
    out.push({
      findingKey: "leak",
      rule: "leak",
      severity: 5,
      element: null,
      brandId: null,
      evidence: { leakShare: input.leakShare },
    });
  }
  for (const [brandId, pull] of Object.entries(input.baseline.pull)) {
    if (brandId !== "none" && pull > input.baseline.attribution) {
      out.push({
        findingKey: `misattribution:${brandId}`,
        rule: "misattribution",
        severity: 4,
        element: null,
        brandId,
        evidence: { pull, attribution: input.baseline.attribution },
      });
    }
  }
  return out;
}

export function diagnose(input: DiagnosisInput): DiagnosisResult {
  const findings = [...input.impacts.flatMap((i) => elementRules(input, i)), ...globalRules(input)];
  findings.sort((a, b) => b.severity - a.severity || (a.findingKey < b.findingKey ? -1 : 1));
  const labels: Record<string, DiagnosisLabel> = {};
  for (const impact of input.impacts) {
    const has = (rule: FindingRule): boolean =>
      findings.some((f) => f.rule === rule && f.element === impact.element);
    labels[impact.element] = has("traitor")
      ? "traitor"
      : has("strong_asset")
        ? "strong_asset"
        : has("decoration")
          ? "decoration"
          : "neutral";
  }
  return { findings, labels };
}
