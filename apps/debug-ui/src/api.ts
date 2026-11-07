import { createClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"] as string;
const anon = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string;

export const sb = createClient(url, anon);

// Anonymous sign-in: the browser holds only the anon key and a user JWT; every write goes through `api`.
export async function ensureSession(): Promise<string> {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.access_token;
  const res = await sb.auth.signInAnonymously();
  if (res.error || !res.data.session) throw new Error(res.error?.message ?? "sign-in failed");
  return res.data.session.access_token;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await ensureSession();
  const res = await fetch(`${url}/functions/v1/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}
