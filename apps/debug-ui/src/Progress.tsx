import { useEffect, useState } from "react";
import { api, sb } from "./api.ts";
import type { AnalysisView } from "./App.tsx";

interface QuotaView {
  models: Array<{ model: string; used: number; limit: number | null }>;
}

export function Progress({ view }: { view: AnalysisView }) {
  const [quota, setQuota] = useState<QuotaView | null>(null);
  const [live, setLive] = useState(0);
  const id = view.analysis.id;
  useEffect(() => {
    // Realtime is a nudge; the 2 s poll in App is the source of truth if the socket drops.
    const ch = sb
      .channel(`events-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "analysis_events", filter: `analysis_id=eq.${id}` }, () => setLive((n) => n + 1))
      .subscribe();
    return () => void sb.removeChannel(ch);
  }, [id]);
  useEffect(() => {
    void api<QuotaView>("GET", "/quota").then(setQuota).catch(() => undefined);
  }, [live]);
  return (
    <section className="rounded border bg-white p-3">
      <h2 className="text-xl">2. Progress — {view.analysis.status}</h2>
      {view.analysis.error && <p className="text-red-700">{view.analysis.error}</p>}
      <p>
        {view.counts.conditions} conditions · panel batches {view.counts.batchesDone}/{view.counts.batchesTotal} · {view.counts.variants} variants
      </p>
      {quota && <p className="text-sm">Quota today: {quota.models.map((m) => `${m.model} ${m.used}${m.limit ? `/${m.limit}` : ""}`).join(", ") || "none used"}</p>}
      <ol className="mt-2 max-h-48 overflow-auto text-sm">
        {view.events.map((e) => (
          <li key={e.id}>{new Date(e.created_at).toLocaleTimeString()} {e.type} {JSON.stringify(e.payload)}</li>
        ))}
      </ol>
    </section>
  );
}
