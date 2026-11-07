// Debug helper: shows messages currently visible in the queues (they reappear after 1 s).
import { createDb } from "../apps/worker/src/db.ts";
import { env } from "./lib.ts";

const e = env(true);
const db = createDb(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
for (const q of ["jobs_high", "jobs_bulk"]) {
  const { data } = await db.rpc("queue_read", { q, vt_s: 1, qty: 10 });
  console.log(q, JSON.stringify((data ?? []).map((m) => ({ id: m.msg_id, readCt: m.read_ct, vt: m.vt, msg: m.message }))));
}
process.exit(0);
