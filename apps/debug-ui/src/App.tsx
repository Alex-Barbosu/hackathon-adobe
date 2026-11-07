import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, sb } from "./api.ts";
import { Diagnosis } from "./Diagnosis.tsx";
import { Progress } from "./Progress.tsx";
import { Quiz } from "./Quiz.tsx";
import { Regions } from "./Regions.tsx";
import { Results } from "./Results.tsx";
import { Setup } from "./Setup.tsx";

export interface AnalysisView {
  analysis: { id: string; status: string; error: string | null };
  events: Array<{ id: number; type: string; payload: unknown; created_at: string }>;
  counts: { conditions: number; batchesDone: number; batchesTotal: number; variants: number };
}

function Stage({ id, status }: { id: string; status: string }) {
  if (status === "needs_review") return <Regions id={id} />;
  if (status === "quiz_ready" || status === "quiz_in_progress") return <Quiz id={id} />;
  if (status === "done") return <Results id={id} />;
  return null;
}

export function App() {
  const [id, setId] = useState<string | null>(localStorage.getItem("analysis"));
  const view = useQuery({
    queryKey: ["analysis", id],
    enabled: id !== null,
    refetchInterval: 2000,
    queryFn: () => api<AnalysisView>("GET", `/analyses/${id ?? ""}`),
  });
  const status = view.data?.analysis.status ?? "";
  const open = (next: string) => {
    localStorage.setItem("analysis", next);
    setId(next);
  };
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl">No Logo</h1>
        <button onClick={() => void sb.auth.signOut().then(() => location.reload())}>New demo user</button>
      </header>
      <Setup onStarted={open} />
      {id && view.data && (
        <>
          <Progress view={view.data} />
          <Stage id={id} status={status} />
          {status !== "needs_review" && view.data.counts.conditions > 0 && <Diagnosis id={id} />}
        </>
      )}
      <footer className="border-t pt-2 text-sm text-stone-600">
        AI panel, not real people. Free-tier Gemini: only use public ads.
      </footer>
    </main>
  );
}
