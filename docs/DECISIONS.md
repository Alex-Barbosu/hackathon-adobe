# Decisions

One short ADR each: context, decision, consequence.

## ADR-001: Use the pre-existing hosted Supabase project
- Context: a `hackathon-adobe` project (ref `vguixuivgzhuspzcefhz`, eu-west-2) already existed.
- Decision: link to it instead of creating a new one.
- Consequence: no new cost; migrations were pushed with `supabase db push --remote --yes`.

## ADR-002: No Docker, hosted only
- Context: Docker is not installed and was declined.
- Decision: no `supabase start`; migrations, types and the Edge Function go straight to the hosted project. Deno comes from npm (`deno check`) for type-checking the function.
- Consequence: no local `db reset`; a bad migration needs a corrective migration. Phase 1 gate items that need a local stack (`db reset`, `functions serve`) are replaced by hosted equivalents.

## ADR-003: Node 24 and pnpm 12 locally
- Decision: `engines.node >= 22`, `@types/node@22`.

## ADR-004: Deno api function excluded from ESLint/tsc
- Decision: checked with `deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts` instead.

## ADR-005: Hand-rolled router in the Edge Function
- Context: Hono support was not verified.
- Decision: a ~30-line regex router in `api/index.ts`.

## ADR-006: Never send `temperature` to Gemini
- Context: docs say Gemini 3.6+ ignore it (400 in future) and earlier Gemini 3 models should keep defaults.
- Decision: the prompt-level temperature stays in the request type and the cache key; the adapter does not send it.
- Consequence: reproducibility comes from the cache, not from sampling.

## ADR-007: pgmq behind `public.queue_*` wrappers
- Decision: security-definer functions granted only to `service_role`; `pgmq_public` is not exposed.

## ADR-008: Paired panel design
- Context: spec seeds persona/exposure/order by condition id.
- Decision: seed by batch index only, so batch j of every condition has identical personas, exposures and candidate order (the control keeps personas/order, drops exposures).
- Consequence: deltas between conditions are not confounded by who looked at what; interval width drops.

## ADR-009: Perceptual hash instead of embedding cosine for exposure dedupe
- Context: `plan_panel` runs before embeddings exist and embedding every exposure would burn quota.
- Decision: 64-bit dHash, exclude exposures within 6 bits of the target (or with equal sha).

## ADR-010: Extra job type and RPCs
- `start_analysis` job (ingest missing ads, then detect); `config_merge` / `config_append` RPCs so parallel jobs cannot lose config writes; `quota_used` RPC for 70/90% quota warnings.

## ADR-011: Reference ads and exposure pool
- Competitor-role ads (2 per competitor brand) feed similarity and are auto-approved after detection; exposure pool is every normalized ad of each candidate brand except the target. Competitors need >= 3 normalized ads, the target brand >= 2 others.

## ADR-012: Competitor colours from palettes, not vote text
- Context: votes carry cue elements, not colours.
- Decision: "colours linked to the competitor" = k-means palette of that competitor's reference ads (`config.competitorPalettes`), used by the quiz contradiction rule and `validatePlan`.

## ADR-013: Brief extension
- `acknowledgements` (known-brand and generic-escape answers) added to `CreativeBrief`.

## ADR-014: Text overlays excluded from the Edit DSL in v1
- Fonts, legibility and accidental brand names are hard to guarantee.

## ADR-015: Locked regions restored after rendering
- Global ops such as `tone` would alter locked regions; the renderer pastes original pixels back into locked and identifier boxes, then still verifies with the guard.

## ADR-016: Offline simulated LLM
- `SimulatedLlm` (colour-layout matcher over thumbnails) lets scripts run the full pipeline without a Gemini key. It is not a language model; its numbers say nothing about real viewers and it is never used by the real worker.

## ADR-017: Generative edits run on Cloudflare Workers AI
- Context: PROMPT.md 14.6 left an optional generative path (Gemini image models, not reliably free). The user chose Cloudflare.
- Decision: new Edit DSL op `generative_inpaint { regionId, instruction }`, off by default (`ENABLE_GENERATIVE_EDITS`). `CloudflareImageEditor` calls `POST /client/v4/accounts/{id}/ai/run/{model}`. Default model `@cf/black-forest-labs/flux-2-klein-4b`; `@cf/runwayml/stable-diffusion-v1-5-inpainting` works too but Cloudflare lists it for deprecation on 2026-11-20.
- Safety: neither documented path takes a mask, so the renderer sends a crop of one unlocked region and pastes the result back inside that region only. Locked regions and identifiers are still restored from the original and the pixel guard still runs. The planner is only shown the op when enabled, and `validatePlan` rejects it otherwise, rejects logo/brand-name instructions and locked regions.
- Caveat: Cloudflare documents the FLUX.2 input only as "multipart" with no field names. The names used (`prompt`, `input_image_0`, `width`, `height`) are constants in `generative.ts`; run `scripts/cf-smoke.ts` to confirm them on your account.
- Consequence: generated pixels are not deterministic, so a re-render of the same plan can differ; the stored render and masked condition are the record of what was tested.

## ADR-018: Wire/strict schema split for Gemini structured output
- Context: Gemini rejects our response schemas with "too many states for serving". It compiles the schema into a state machine, and numeric bounds, string lengths, patterns, formats, item counts and especially unions (the Edit DSL's 8-way `oneOf`, repeated per plan) multiply the states. The docs say `minItems`/`maxItems` are enforced, so we had left those in; the live API disagrees in practice.
- Decision: two schemas per request.
  - **Strict** is the zod schema. It still validates every parsed response in `LlmService` and keeps the one-repair-round behaviour, so no guarantee is lost.
  - **Wire** is `toWireSchema()` in `llm/gemini.ts`, applied inside `GeminiTransport.generate`. It strips `$schema, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength, maxLength, pattern, format, minItems, maxItems, minProperties, maxProperties, uniqueItems`, never touching field *names* under `properties`. A discriminated union becomes one object (the discriminator `op` as an `enum`, every other field optional); `T | null` becomes a type array; any other union throws at build time rather than 400ing at run time.
- Consequence: the model can now produce things the strict schema rejects (wrong plan count, an out-of-range factor, a scale op missing `factor`). Those are caught by zod, trigger the single repair call, and otherwise surface as `SchemaInvalidError`. Prompts must therefore state the limits in words (they already do: "exactly 3 plans", "at most 6 operations"). Cache keys hash the request, not the schema JSON, so cached answers stay valid.
- Guard: `wire.test.ts` builds the wire schema for every `Task` (typed `Record<Task, ...>`, so a new task without a schema fails the typecheck) and asserts that no stripped key and no `anyOf`/`oneOf`/`allOf` remain.
- Not yet confirmed against the live API: Gemini calls are currently blocked by a billing 402 on our key, so "accepted by Gemini" is still to be checked with `scripts/llm-smoke.ts`.
