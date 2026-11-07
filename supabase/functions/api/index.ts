// Thin Edge Function: auth, validate, write, enqueue. Phase 0 only proves the shared core imports.
import { clampBox } from "../_shared/core/index.ts";

Deno.serve((req: Request): Response => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/health")) {
    return Response.json({ ok: true, clamped: clampBox([-5, 10, 1200, 999]) });
  }
  return Response.json({ error: "not_found" }, { status: 404 });
});
