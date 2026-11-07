# Decisions

## ADR-001: Use the pre-existing hosted Supabase project

- Context: Phase 0 asked to start the Supabase project; a `hackathon-adobe` project (ref `vguixuivgzhuspzcefhz`, eu-west-2) already existed in the account, created today.
- Decision: link to it instead of creating a new (possibly paid) project.
- Consequence: no new cost. Migrations are Phase 1, so `supabase db push` had nothing to push in Phase 0.

## ADR-002: Local stack not started in Phase 0

- Context: `supabase start` and `supabase functions serve` require Docker, which is not installed on this machine.
- Decision: the core-sharing proof runs from Vitest only for now; the Edge Function import is written but unserved.
- Consequence: install Docker Desktop (or use `deno check`) to complete the Phase 0 gate item.

## ADR-003: Node 24 and pnpm 12 locally

- Context: prompt says Node 22 LTS; machine has Node 24 and pnpm 12.
- Decision: `engines.node >=22`, types pinned to `@types/node@22`.

## ADR-004: Deno api function excluded from ESLint/tsc

- Context: it uses the `Deno` global and `npm:` specifiers.
- Decision: excluded from the Node toolchain; to be checked with `deno check` once Deno/Docker is available.
