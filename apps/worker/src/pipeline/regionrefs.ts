import type { PlanRegion } from "@nologo/core";
import type { RegionLite } from "../jobs/data.ts";
import type { RenderRegion } from "../image/render.ts";

// The planner sees "R1".."Rn"; sorting by uuid keeps the mapping stable between planning and rendering.
export function buildRefs(regions: readonly RegionLite[], lockedIds: readonly string[]): Array<PlanRegion & RenderRegion & { regionId: string }> {
  return [...regions]
    .filter((r) => r.approved)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r, i) => ({
      ref: `R${i + 1}`,
      regionId: r.id,
      kind: r.kind,
      box: r.box,
      isIdentifier: r.isIdentifier,
      locked: r.isIdentifier || lockedIds.includes(r.id),
    }));
}

export function regionsTable(refs: ReadonlyArray<PlanRegion & { regionId: string }>, labels: ReadonlyMap<string, string | null>): string {
  return refs
    .map((r) => `${r.ref}: ${r.kind} "${labels.get(r.regionId) ?? r.kind}" box [${r.box.join(", ")}] locked: ${r.locked ? "yes" : "no"}`)
    .join("\n");
}
