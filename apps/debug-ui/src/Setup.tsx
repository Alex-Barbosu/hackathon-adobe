import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ensureSession, sb } from "./api.ts";

interface Brand {
  id: string;
  name: string;
  slug: string;
  category: string;
}
interface Ad {
  id: string;
  brand_id: string;
  status: string;
}

function NewBrand({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("snack bars");
  const create = async () => {
    await api("POST", "/brands", { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, category });
    setName("");
    onDone();
  };
  return (
    <div className="flex gap-2">
      <input placeholder="Brand name" value={name} onChange={(e) => setName(e.target.value)} />
      <input value={category} onChange={(e) => setCategory(e.target.value)} />
      <button disabled={!name} onClick={() => void create()}>Add brand</button>
    </div>
  );
}

async function upload(brandId: string, file: File): Promise<void> {
  const contentType = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/webp" ? "image/webp" : "image/png";
  const up = await api<{ adId: string; path: string; token: string }>("POST", "/ads/upload-url", { brandId, contentType });
  await ensureSession();
  const { error } = await sb.storage.from("ads-original").uploadToSignedUrl(up.path, up.token, file, { contentType });
  if (error) throw new Error(error.message);
  await api("POST", `/ads/${up.adId}/ingest`);
}

export function Setup({ onStarted }: { onStarted: (id: string) => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const [rivals, setRivals] = useState<string[]>([]);
  const [error, setError] = useState("");
  const data = useQuery({
    queryKey: ["setup"],
    refetchInterval: 3000,
    queryFn: async () => {
      await ensureSession();
      const brands = (await sb.from("brands").select("*").order("created_at")).data as Brand[] | null;
      const ads: Ad[] = (await sb.from("ads").select("id, brand_id, status")).data ?? [];
      return { brands: brands ?? [], ads };
    },
  });
  const start = async () => {
    setError("");
    try {
      const a = await api<{ id: string }>("POST", "/analyses", { targetAdId: target, competitorBrandIds: rivals });
      onStarted(a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const brands = data.data?.brands ?? [];
  const ads = data.data?.ads ?? [];
  return (
    <section className="space-y-3 rounded border bg-white p-3">
      <h2 className="text-xl">1. Setup</h2>
      <NewBrand onDone={() => void qc.invalidateQueries({ queryKey: ["setup"] })} />
      {brands.map((b) => (
        <div key={b.id} className="flex items-center gap-3">
          <strong className="w-32">{b.name}</strong>
          <span>{ads.filter((a) => a.brand_id === b.id).length} ads ({ads.filter((a) => a.brand_id === b.id && a.status === "normalized").length} ready)</span>
          <input type="file" accept="image/*" multiple onChange={(e) => void Promise.all([...(e.target.files ?? [])].map((f) => upload(b.id, f)))} />
          <label><input type="checkbox" checked={rivals.includes(b.id)} onChange={(e) => setRivals(e.target.checked ? [...rivals, b.id] : rivals.filter((r) => r !== b.id))} /> competitor</label>
        </div>
      ))}
      <div className="flex gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Target ad…</option>
          {ads.map((a) => (
            <option key={a.id} value={a.id}>{brands.find((b) => b.id === a.brand_id)?.name} — {a.id.slice(0, 6)}</option>
          ))}
        </select>
        <button disabled={!target || rivals.length < 2} onClick={() => void start()}>Start analysis</button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
    </section>
  );
}
