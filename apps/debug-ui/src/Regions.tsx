import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

interface Region {
  id?: string;
  kind: string;
  box: number[];
  label: string | null;
  approved: boolean;
}
interface Payload {
  regions: Region[];
  imageUrl: string | null;
}

const KINDS = ["logo", "brand_name", "packaging_text", "url_or_handle", "mascot_character", "product", "other_text", "person", "graphic_element"];
const IDENTIFIERS = new Set(KINDS.slice(0, 4));

export function Regions({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["regions", id], queryFn: () => api<Payload>("GET", `/analyses/${id}/regions`), staleTime: Infinity });
  const [regions, setRegions] = useState<Region[]>([]);
  useEffect(() => {
    if (q.data) setRegions(q.data.regions);
  }, [q.data]);
  const set = (i: number, patch: Partial<Region>) => setRegions(regions.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async (force: boolean) => {
    await api("PUT", `/analyses/${id}/regions`, {
      regions: regions.map((r) => ({ ...(r.id ? { id: r.id } : {}), kind: r.kind, box: r.box, label: r.label ?? undefined, approved: r.approved })),
    });
    await api("POST", `/analyses/${id}/regions/approve`, { force });
  };
  return (
    <section className="space-y-2 rounded border bg-white p-3">
      <h2 className="text-xl">3. Review regions</h2>
      <p className="text-sm">Identifiers (red) get masked. Edit boxes as [ymin, xmin, ymax, xmax] in 0–1000.</p>
      <div className="relative inline-block">
        {q.data?.imageUrl && <img src={q.data.imageUrl} className="max-h-96" />}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          {regions.map((r, i) => (
            <rect key={i} x={r.box[1]} y={r.box[0]} width={(r.box[3] ?? 0) - (r.box[1] ?? 0)} height={(r.box[2] ?? 0) - (r.box[0] ?? 0)}
              fill="none" strokeWidth={4} stroke={IDENTIFIERS.has(r.kind) ? "red" : "blue"} opacity={r.approved ? 1 : 0.35} />
          ))}
        </svg>
      </div>
      {regions.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" checked={r.approved} onChange={(e) => set(i, { approved: e.target.checked })} />
          <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <input className="w-56" value={r.box.join(",")} onChange={(e) => set(i, { box: e.target.value.split(",").map((n) => Number(n)) })} />
          <span>{r.label}</span>
          <button onClick={() => setRegions(regions.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button onClick={() => setRegions([...regions, { kind: "logo", box: [0, 0, 100, 100], label: "manual", approved: true }])}>Add box</button>{" "}
      <button onClick={() => void save(false)}>Approve and continue</button>{" "}
      <button onClick={() => void save(true)}>Force approve</button>
    </section>
  );
}
