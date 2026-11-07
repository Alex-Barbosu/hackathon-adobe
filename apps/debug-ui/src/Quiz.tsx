import { useEffect, useState } from "react";
import { api } from "./api.ts";

interface Question {
  id: string;
  key: string;
  type: string;
  prompt: string;
  help: string | null;
  options: Array<{ value: string; label: string }>;
  constraints: { min?: number; max?: number; minLabel?: string; maxLabel?: string; axes?: Array<{ key: string; left: string; right: string }>; recommended?: unknown };
}
interface Direction {
  id: string;
  title: string;
  description: string;
}
type Step =
  | { kind: "question"; question: Question }
  | { kind: "pairwise"; round: { id: string; index: number; total: number; a: Direction; b: Direction } }
  | { kind: "ready_to_finish" };
interface Response {
  sessionId?: string;
  next: Step;
  warnings?: string[];
  progress: { asked: number; max: number; requiredLeft: number };
}

function Widget({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: unknown) => void }) {
  const arr = Array.isArray(value) ? (value as string[]) : [];
  switch (q.type) {
    case "single_choice":
      return <>{q.options.map((o) => <label key={o.value} className="block"><input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}</label>)}</>;
    case "yes_no":
      return <><button onClick={() => onChange(true)}>Yes</button> <button onClick={() => onChange(false)}>No</button></>;
    case "multi_choice":
    case "palette":
      return <>{q.options.map((o) => <label key={o.value} className="block"><input type="checkbox" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} /> {o.label}</label>)}</>;
    case "rank":
      return (
        <>
          <p className="text-sm">Click in order of importance: {arr.join(" > ") || "(none yet)"}</p>
          {q.options.map((o) => <button key={o.value} disabled={arr.includes(o.value)} onClick={() => onChange([...arr, o.value])}>{o.label}</button>)}{" "}
          <button onClick={() => onChange([])}>Reset</button>
        </>
      );
    case "slider":
      return <><span>{q.constraints.minLabel}</span> <input type="range" min={q.constraints.min} max={q.constraints.max} value={Number(value ?? q.constraints.min ?? 1)} onChange={(e) => onChange(Number(e.target.value))} /> <span>{q.constraints.maxLabel} ({String(value ?? "")})</span></>;
    case "semantic_pair": {
      const v = (value ?? {}) as Record<string, number>;
      return <>{q.constraints.axes?.map((a) => <div key={a.key}>{a.left} <input type="range" min={-2} max={2} value={v[a.key] ?? 0} onChange={(e) => onChange({ warmPrecise: 0, playfulPremium: 0, boldCalm: 0, ...v, [a.key]: Number(e.target.value) })} /> {a.right}</div>)}</>;
    }
    default:
      return <textarea className="w-full rounded border" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function Quiz({ id }: { id: string }) {
  const [session, setSession] = useState<string | null>(null);
  const [res, setRes] = useState<Response | null>(null);
  const [value, setValue] = useState<unknown>(undefined);
  const [brief, setBrief] = useState<unknown>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Response>("POST", "/quiz/start", { analysisId: id }).then((r) => { setSession(r.sessionId ?? null); setRes(r); }).catch((e: Error) => setError(e.message));
  }, [id]);
  const send = async (path: string, body?: unknown) => {
    try {
      setError("");
      const r = await api<Response>("POST", `/quiz/${session ?? ""}${path}`, body);
      setRes(r);
      setValue(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const step = res?.next;
  return (
    <section className="space-y-2 rounded border bg-white p-3">
      <h2 className="text-xl">4. Quiz {res && `(${res.progress.asked}/${res.progress.max}, ${res.progress.requiredLeft} required left)`}</h2>
      {error && <p className="text-red-700">{error}</p>}
      {res?.warnings?.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
      {step?.kind === "question" && (
        <div className="space-y-2">
          <p className="font-semibold">{step.question.prompt}</p>
          {step.question.help && <p className="text-sm">{step.question.help}</p>}
          <Widget q={step.question} value={value} onChange={setValue} />
          <div><button disabled={value === undefined} onClick={() => void send("/answer", { questionId: step.question.id, value })}>Answer</button>{" "}
            <button onClick={() => void send("/use-recommended", { questionId: step.question.id })}>Use recommended</button></div>
        </div>
      )}
      {step?.kind === "pairwise" && (
        <div>
          <p>Round {step.round.index + 1} of {step.round.total}: which direction?</p>
          <div className="grid grid-cols-2 gap-3">
            {(["a", "b"] as const).map((k) => (
              <button key={k} className="text-left" onClick={() => void send("/pairwise", { roundId: step.round.id, choice: k })}>
                <strong>{step.round[k].title}</strong><br />{step.round[k].description}
              </button>
            ))}
          </div>
          <button onClick={() => void send("/pairwise", { roundId: step.round.id, choice: "neither" })}>Neither</button>
        </div>
      )}
      {step?.kind === "ready_to_finish" && !brief && (
        <button onClick={() => void api("POST", `/quiz/${session ?? ""}/finish`).then(setBrief).catch((e: Error) => setError(e.message))}>Finish and plan variants</button>
      )}
      {brief !== null && <pre className="overflow-auto text-xs">{JSON.stringify(brief, null, 2)}</pre>}
    </section>
  );
}
