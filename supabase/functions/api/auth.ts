import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { JobMessage, queueFor, type JobMessageValue } from "../_shared/core/index.ts";
import { ApiError } from "./http.ts";

export interface Auth {
  uid: string;
  // Service-role client. Only used after the caller's identity is verified and ownership is checked.
  admin: SupabaseClient;
}

export async function authenticate(req: Request): Promise<Auth> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError(401, "unauthenticated", "Missing bearer token");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "unauthenticated", "Invalid or expired token");
  return { uid: data.user.id, admin };
}

export async function enqueue(admin: SupabaseClient, msg: JobMessageValue): Promise<void> {
  const valid = JobMessage.parse(msg);
  const { error } = await admin.rpc("queue_send", { q: queueFor(valid.type), msg: valid, delay_s: 0 });
  if (error) throw new Error(`queue_send: ${error.message}`);
}

export async function transition(
  admin: SupabaseClient,
  id: string,
  from: string[],
  to: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("set_analysis_status", { p_id: id, p_from: from, p_to: to });
  if (error) throw new Error(`set_analysis_status: ${error.message}`);
  return data === true;
}

// Ownership check by uuid; 404 (not 403) so ids of other users are not confirmed to exist.
export async function owned<T = Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  id: string,
  uid: string,
  ownerColumn = "owner_id",
): Promise<T> {
  const { data, error } = await admin.from(table).select("*").eq("id", id).eq(ownerColumn, uid).maybeSingle();
  if (error) throw new Error(`${table} lookup: ${error.message}`);
  if (!data) throw new ApiError(404, "not_found", `${table} not found`);
  return data as T;
}

export async function signUrl(admin: SupabaseClient, bucket: string, path: string, seconds = 600): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(`sign ${bucket}/${path}: ${error.message}`);
  return data.signedUrl;
}
