import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

interface Conditions {
  id: string;
  kind: string;
  element: string | null;
  imageUrl: string;
  metrics: { attribution: number; attribution_ci: number[]; n_votes: number } | null;
}
interface Diag {
  elementImpacts: Array<{ element: string; delta: number; delta_ci: number[]; label: string }>;
  findings: Array<{ finding_key: string; rule: string; severity: number; evidence: unknown }>;
  similarity: { centroid_percentile: number; nearest_sim: number } | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Bar({ value, ci }: { value: number; ci: number[] }) {
  return (
    <div className="relative h-3 w-64 bg-stone-200">
      <div className="h-3 bg-accent" style={{ width: `${value * 100}%` }} />
      <div className="absolute top-1 h-1 bg-stone-900" style={{ left: `${(ci[0] ?? 0) * 100}%`, width: `${((ci[1] ?? 0) - (ci[0] ?? 0)) * 100}%` }} />
    </div>
  );
}

export function Diagnosis({ id }: { id: string }) {
  const conds = useQuery({ queryKey: ["conditions", id], refetchInterval: 4000, queryFn: () => api<Conditions[]>("GET", `/analyses/${id}/conditions`) });
  const diag = useQuery({ queryKey: ["diagnosis", id], refetchInterval: 4000, queryFn: () => api<Diag>("GET", `/analyses/${id}/diagnosis`) });
  return (
    <section className="space-y-3 rounded border bg-white p-3">
      <h2 className="text-xl">Conditions and diagnosis</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {conds.data?.map((c) => (
          <figure key={c.id} className="text-xs">
            <img src={c.imageUrl} className="w-full" />
            <figcaption>{c.kind}{c.element ? `: ${c.element}` : ""}</figcaption>
            {c.metrics && (
              <>
                <Bar value={c.metrics.attribution} ci={c.metrics.attribution_ci} />
                {pct(c.metrics.attribution)} ({pct(c.metrics.attribution_ci[0] ?? 0)}–{pct(c.metrics.attribution_ci[1] ?? 0)}), n={c.metrics.n_votes}
              </>
            )}
          </figure>
        ))}
      </div>
      {diag.data && (
        <>
          <h3 className="text-lg">Element impacts</h3>
          <ul>{diag.data.elementImpacts.map((e) => <li key={e.element}>{e.element}: {e.label}, delta {pct(e.delta)} ({pct(e.delta_ci[0] ?? 0)}–{pct(e.delta_ci[1] ?? 0)})</li>)}</ul>
          <h3 className="text-lg">Findings</h3>
          <ul>{diag.data.findings.map((f) => <li key={f.finding_key}>[{f.severity}] {f.finding_key} <code className="text-xs">{JSON.stringify(f.evidence)}</code></li>)}</ul>
          {diag.data.similarity && <p>Category similarity percentile: {pct(diag.data.similarity.centroid_percentile)}</p>}
        </>
      )}
    </section>
  );
}
