import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./db.types.ts";
import { FatalError, RetryableError } from "./errors.ts";

export type Db = SupabaseClient<Database>;
export type { Database, Json };

export function createDb(url: string, serviceRoleKey: string): Db {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Round-trips through JSON so `undefined` fields disappear and the value is a valid jsonb payload.
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

interface DbResult<T> {
  data: T;
  error: PostgrestError | null;
}

// A missing row is a logic error (fatal); anything else from the database is treated as transient.
export function must<T>(res: DbResult<T>, what: string): NonNullable<T> {
  if (res.error) {
    if (res.error.code === "PGRST116") throw new FatalError(`${what}: row not found`);
    throw new RetryableError(`${what}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) throw new FatalError(`${what}: no data returned`);
  return res.data;
}

export function mustOk(res: { error: PostgrestError | null }, what: string): void {
  if (res.error) throw new RetryableError(`${what}: ${res.error.message}`);
}

// RPC results that legitimately return no row (void functions) use mustOk instead.
export const PACIFIC_TZ = "America/Los_Angeles";

// RPD resets at midnight Pacific, so quota rows are keyed by the Pacific calendar day.
export function pacificDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
