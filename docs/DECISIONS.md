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
