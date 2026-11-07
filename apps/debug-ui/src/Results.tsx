import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

interface Variant {
  id: string;
  idx: number;
  status: string;
  hypothesis: string;
  change_ratio: number | null;
  renderUrl: string | null;
  maskedUrl: string | null;
  metrics: { delta: number; deltaCi: number[] } | null;
  brand_fit: { pass: boolean } | null;
  rejection_reasons: string[] | null;
}
interface Report {
  markdown: string;
  numberCheck: { offending: string[] };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Results({ id }: { id: string }) {
  const variants = useQuery({ queryKey: ["variants", id], queryFn: () => api<Variant[]>("GET", `/analyses/${id}/variants`) });
  const report = useQuery({ queryKey: ["report", id], queryFn: () => api<Report>("GET", `/analyses/${id}/report`) });
  return (
    <section className="space-y-3 rounded border bg-white p-3">
      <h2 className="text-xl">5. Variants and report</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {variants.data?.map((v) => (
          <figure key={v.id} className="text-sm">
            {v.renderUrl && <img src={v.renderUrl} className="w-full" />}
            {v.maskedUrl && <img src={v.maskedUrl} className="mt-1 w-full opacity-80" />}
            <figcaption>
              V{v.idx + 1} — {v.status}. {v.hypothesis}
              {v.change_ratio !== null && <> Changed {pct(v.change_ratio)} of pixels.</>}
              {v.metrics && <> Attribution change {pct(v.metrics.delta)} ({pct(v.metrics.deltaCi[0] ?? 0)}–{pct(v.metrics.deltaCi[1] ?? 0)}).</>}
              {v.brand_fit && <> Brand fit {v.brand_fit.pass ? "passes" : "does not pass"}.</>}
              {v.rejection_reasons?.map((r) => <div key={r} className="text-red-700">{r}</div>)}
            </figcaption>
          </figure>
        ))}
      </div>
      {report.data && (
        <>
          <pre className="whitespace-pre-wrap font-sans">{report.data.markdown}</pre>
          {report.data.numberCheck.offending.length > 0 && <p className="text-amber-700">Number check warning: {report.data.numberCheck.offending.join(", ")}</p>}
        </>
      )}
    </section>
  );
}
