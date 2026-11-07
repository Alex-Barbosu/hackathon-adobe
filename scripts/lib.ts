import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv, type Env } from "../apps/worker/src/env.ts";

export function env(simulated: boolean): Env {
  try {
    process.loadEnvFile(".env");
  } catch {
    // rely on the real environment
  }
  if (simulated) process.env["GEMINI_API_KEY"] ??= "simulated";
  return loadEnv(process.env);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in .env`);
  return v;
}

export interface Session {
  sb: SupabaseClient;
  token: string;
  uid: string;
}

const SESSION_FILE = "tmp/session.json";

// One anonymous demo user per machine, kept in tmp/ so every script sees the same data.
export async function session(): Promise<Session> {
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  if (existsSync(SESSION_FILE)) {
    const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as { refresh_token: string };
    const { data } = await sb.auth.refreshSession({ refresh_token: saved.refresh_token });
    if (data.session) return save(sb, data.session);
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`Anonymous sign-in failed (enable it in Auth settings): ${error?.message ?? "no session"}`);
  return save(sb, data.session);
}

function save(sb: SupabaseClient, s: { access_token: string; refresh_token: string; user: { id: string } }): Session {
  mkdirSync("tmp", { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify({ refresh_token: s.refresh_token }));
  return { sb, token: s.access_token, uid: s.user.id };
}

export async function api<T>(s: Session, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${need("SUPABASE_URL")}/functions/v1/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, apikey: need("SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { error?: { code: string; message: string } } & T;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.code ?? ""}: ${json.error?.message ?? ""}`);
  return json;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}
