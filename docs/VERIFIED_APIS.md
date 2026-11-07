# Verified APIs

Only items actually checked are listed. Everything else is **not yet verified** and must be checked in its phase.

## Verified 2026-11-07

- `@google/genai` **3.0.0** installed. It exposes both `client.models.*` (incl. `models.list()` returning an async-iterable `Pager<Model>`, used by `--dry-run`) and an `Interactions` client. Primary call style to be chosen in Phase 4.
- Model ids `gemini-3.5-flash-lite`, `gemini-3.8-flash` appear on https://ai.google.dev/gemini-api/docs/models. `gemini-embedding-2` was not confirmed from that page; the startup check via `models.list()` is authoritative.
- Supabase CLI 3.0.0; project linked (`supabase link`), hosted Postgres 17.

## Not yet verified (Phase 0 gate items still open)

Structured-output JSON-schema subset, thinking levels, embeddings params, 429 error shape, free-tier limits, Supabase Queues from server code, Edge Function limits, anonymous auth, signed upload URLs, Hono in Edge Functions, zod import for Deno.
