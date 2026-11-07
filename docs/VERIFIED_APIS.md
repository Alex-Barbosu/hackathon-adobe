# Verified APIs

Each item lists what was checked, where, and when. Anything not listed here has **not** been verified.

## Gemini API (checked 2026-11-07)

Sources: `ai.google.dev/gemini-api/docs/{interactions,structured-output,image-understanding,embeddings,thinking,rate-limits,troubleshooting,models}` and the typings of the installed `@google/genai`.

- **SDK**: `@google/genai` **3.0.0**. It exposes `client.interactions.create(...)`, `client.models.list()` (async-iterable `Pager<Model>`) and `client.models.embedContent(...)`.
- **Call style**: the docs state the **Interactions API is GA (June 2026) and the recommended interface for new projects**; `generateContent` is "legacy" but supported. We use `interactions.create` and isolate it in `apps/worker/src/llm/gemini.ts`.
  - Request: `{ model, input: [{type:"text", text}, {type:"image", data:<base64>, mime_type:"image/png"}], system_instruction, generation_config: { thinking_level }, response_format: { type:"text", mime_type:"application/json", schema }, store:false }`.
  - Response: `interaction.output_text`; usage in `interaction.usage.{total_input_tokens,total_output_tokens,total_thought_tokens}`.
  - `store: false` is supported (stateless); we set it so ad content is not retained server-side.
  - Multiple images in one request: repeat `{type:"image"}` items (docs show two).
- **Structured output (section 9.1)**: the docs list a JSON-schema **subset**: types `string, number, integer, boolean, object, array, null`, `enum`, `format`, `minimum/maximum`, `items/prefixItems`, `minItems/maxItems`, `required`, `additionalProperties`; `minLength/maxLength/minProperties/uniqueItems/contains` are stripped server-side, and `minItems/maxItems` are documented as enforced. **In practice the API also rejects schemas with `400 "too many states for serving"`**: constraint keywords and, above all, unions add states to the compiled grammar. Decision (ADR-018): send a deliberately loose *wire* schema and validate with the full zod schema. The wire schema removes every bound, length, pattern, format and item-count key (including `minItems/maxItems`, despite the docs) and contains no `anyOf/oneOf`: the Edit DSL union is flattened to one object with an `op` enum and optional fields. Unions of non-objects that zod emits as `type: [...]` are kept; any other union throws when the schema is built. We use arrays of `{key, value}` instead of records. `z.toJSONSchema(schema, { target: "draft-7" })` is the starting point and `$schema` is dropped. **Status: the stripping is unit-tested for all nine tasks; acceptance by the live API is unverified until a key with billing credit runs `scripts/llm-smoke.ts`.**
- **Thinking levels** (`generation_config.thinking_level`): `gemini-3.5-flash-lite`: minimal, low, medium, high (default minimal). `gemini-3.8-flash`: **low, medium, high only (no `minimal`)**, default medium. The adapter therefore never sends `minimal` to a model that does not list it; detection uses `minimal` when allowed, else `low`.
- **Sampling parameters**: "Gemini 4 and Gemini 3.6+ models ignore custom `temperature`/`top_p`/`top_k` and return deprecation warning headers (and will return `400` errors in a future release)"; for earlier Gemini 3 models, keep them at defaults. **Decision**: the adapter never sends `temperature`. The prompt-level temperature stays in the request type and in the cache key, so determinism comes from the cache, not from sampling (ADR-006).
- **Bounding boxes**: `box_2d` = `[ymin, xmin, ymax, xmax]` normalized to 0-1000 (matches our storage convention).
- **Embeddings**: `gemini-embedding-2` is multimodal; call `client.models.embedContent({ model, contents: [{ inlineData: { mimeType, data } }], config: { outputDimensionality } })`. Max **6 images per request**, PNG/JPEG, 8192 input tokens. `output_dimensionality` range 128-3072 (recommended 768, 1536, 3072). **Below 3072 dims the model normalizes automatically**; we L2-normalize anyway.
- **Rate limits**: applied **per project**, RPD resets at **midnight Pacific**. Real numbers live in the user's AI Studio page; defaults in `.env.example` are conservative guesses.
- **Errors**: retry only `429`, `408`, `5xx` with exponential backoff + jitter; never retry `400/402/403`. The docs do not show a machine-readable retry delay for the Interactions API, so the client parses `retry in Ns` / `retryDelay` out of the error message when present and otherwise uses backoff.
- **Models page** lists `gemini-3.5-flash-lite`, `gemini-3.8-flash`. `gemini-embedding-2` is documented on the embeddings page. Startup still lists models through `models.list()` and refuses to start if a required id is missing.
- **Free tier data use**: free-tier content may be used by Google to improve products; only public ads go through the system (README + UI notice).

## Supabase (checked 2026-11-07, against the hosted project)

- CLI 3.0.0. `supabase link`, `supabase db push --remote --include-seed --yes`, `supabase gen types typescript --linked` all worked against the hosted project; **no Docker needed**. In agent mode the CLI demands `--yes` for hosted mutations.
- **pgmq** installs with `create extension pgmq` inside a migration on hosted Postgres 17; `pgmq.create('jobs_high')` works in a migration. We wrap `pgmq.send/read/delete/archive` in `public.queue_*` security-definer functions granted only to `service_role`, so `pgmq_public` is never exposed (ADR-007).
- **pgvector** installs in the `extensions` schema; the column type is `extensions.vector(768)` and the operator is `operator(extensions.<=>)`.
- Realtime: `alter publication supabase_realtime add table analysis_events;` applied cleanly.

## Not yet verified in code (see DECISIONS.md for status)

Anonymous sign-in availability on the project, Edge Function deploy without Docker (`supabase functions deploy --use-api`), Hono in Edge Functions (we use a hand-rolled router, ADR-005), signed upload URL behaviour.

## Cloudflare Workers AI (checked 2026-11-07)
- Source: developers.cloudflare.com/workers-ai (models pages, REST API page).
- REST: `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}` with `Authorization: Bearer {API_TOKEN}`; the token needs Workers AI Read and Edit.
- `@cf/black-forest-labs/flux-2-klein-4b` and `flux-2-dev` combine generation and editing; input schema is `multipart` (field names not documented), output `{ image: <base64> }`.
- `@cf/runwayml/stable-diffusion-v1-5-inpainting`: JSON `prompt`, `negative_prompt`, `image` (byte array) or `image_b64`, `mask` (byte array), `strength`, `num_steps` (max 20), `seed`. **Planned deprecation 2026-11-20.**
- **Not verified**: the FLUX.2 multipart field names and the current free-tier limits. Run `scripts/cf-smoke.ts`.
