// RLS check against the hosted project: user B must not see or fetch user A's data.
// Run after seed-demo and one analysis. Exits non-zero on any leak.
import { createClient } from "@supabase/supabase-js";
import { api, session } from "./lib.ts";

const url = process.env["SUPABASE_URL"] ?? "";
try {
  process.loadEnvFile(".env");
} catch {
  // use the real environment
}
const anon = process.env["SUPABASE_ANON_KEY"] ?? "";
const a = await session();
const sbB = createClient(process.env["SUPABASE_URL"] ?? url, anon, { auth: { persistSession: false } });
const signIn = await sbB.auth.signInAnonymously();
if (signIn.error || !signIn.data.session) throw new Error(`user B sign-in failed: ${signIn.error?.message ?? ""}`);
const b = { sb: sbB, token: signIn.data.session.access_token, uid: signIn.data.session.user.id };
if (a.uid === b.uid) throw new Error("A and B are the same user");

const failures: string[] = [];
const expect = (ok: boolean, what: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const own = await a.sb.from("analyses").select("id").limit(1);
const analysisId = own.data?.[0]?.id as string | undefined;
expect((own.data?.length ?? 0) > 0, "A can read their own analysis");
for (const table of ["brands", "ads", "analyses", "analysis_events", "conditions", "findings", "variants", "reports"]) {
  const { data } = await b.sb.from(table).select("*").limit(5);
  expect((data ?? []).length === 0, `B sees no rows in ${table}`);
}
for (const table of ["ai_cache", "ai_calls", "ai_quota", "embeddings"]) {
  const { data, error } = await b.sb.from(table).select("*").limit(1);
  expect(error !== null || (data ?? []).length === 0, `B cannot read ${table}`);
}
const personas = await b.sb.from("personas").select("id").limit(1);
expect((personas.data ?? []).length === 1, "personas are readable by any signed-in user");
const write = await b.sb.from("brands").insert({ slug: "x", name: "x", category: "x" });
expect(write.error !== null, "B cannot write tables directly");
if (analysisId) {
  const res = await fetch(`${process.env["SUPABASE_URL"] ?? ""}/functions/v1/api/analyses/${analysisId}`, {
    headers: { Authorization: `Bearer ${b.token}`, apikey: anon },
  });
  expect(res.status === 404, `API returns 404 for B on A's analysis (got ${res.status})`);
  await api(a, "GET", `/analyses/${analysisId}`);
  expect(true, "API still serves A");
}
process.exit(failures.length === 0 ? 0 : 1);
