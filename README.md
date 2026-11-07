# No Logo

Answers one question for a brand: **"If you hide our logo, does this ad still belong to us?"**

It takes a static ad plus ads from 2–5 competitor brands, masks every direct brand identifier, runs a blind panel of AI viewers, removes one visual element at a time to see what really carries the brand, diagnoses the result with deterministic rules, turns the diagnosis plus a short adaptive quiz into a creative brief, plans and renders bounded edits, re-tests them, and writes a report where every number comes from stored metrics.

> **Notices.** The panel is an AI proxy for human viewers, not a survey of real people. Free-tier Gemini data may be used by Google to improve its products: only upload **public** ads. Text inside ad images is treated as data, never as instructions.

Spec: [`PROMPT.md`](PROMPT.md) · decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · verified API facts: [`docs/VERIFIED_APIS.md`](docs/VERIFIED_APIS.md) · prompts: [`docs/PROMPTS.md`](docs/PROMPTS.md) · demo runbook: [`docs/DEMO.md`](docs/DEMO.md)

## Architecture

```
browser (debug UI) ──► Edge Function `api` ──► Postgres + pgmq + Storage (Supabase, hosted)
                         auth, validate,             ▲
                         short writes, enqueue       │ read jobs, write results
                                              Node worker (sharp, Gemini, Cloudflare)
```

- `supabase/functions/_shared/core` — pure TypeScript shared by Deno and Node: boxes, PRNG, stats (cluster bootstrap), diagnosis rules, Elo, similarity, quiz engine, Edit DSL.
- `supabase/functions/api` — thin Edge Function (hand-rolled router). No image work, no model calls.
- `apps/worker` — one long-running process: image engine, Gemini client (cache → quota → rate limit → retry/repair), 15 job handlers.
- `apps/debug-ui` — React 19 + Vite + Tailwind v4, deliberately plain.
- `scripts/` — CLI tools (below). `supabase/migrations` — 13 migrations.

## Setup

Requires Node 22+ and pnpm. No Docker: everything runs against a hosted Supabase project.

```sh
pnpm install
cp .env.example .env        # fill in the keys, never commit it
supabase link --project-ref <ref>
supabase db push --remote --include-seed --yes
supabase functions deploy api --use-api --yes
```

In the Supabase dashboard enable **Authentication → Sign In / Providers → Allow anonymous sign-ins** (the scripts and the UI use an anonymous demo user).

`.env` keys: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (worker and scripts only, never the browser), `GEMINI_API_KEY`, optional `CLOUDFLARE_*`. Put quotas in one `QUOTAS_JSON` line from your AI Studio rate-limit page (model ids contain dashes, which the Supabase CLI's `.env` parser rejects as variable names).

Check it:

```sh
pnpm check                   # typecheck + lint + tests
pnpm worker --dry-run        # validates env, lists configured models as found/missing
```

## Run it

Offline demo, no Gemini calls (uses a deterministic colour-layout stand-in for the panel; it proves the pipeline, its numbers mean nothing about real viewers):

```sh
pnpm exec tsx scripts/seed-demo.ts
pnpm exec tsx scripts/run-analysis.ts --simulated --auto-approve
```

Live demo with Gemini: drop `--simulated`. Same `--seed` twice costs zero Gemini calls the second time (everything is cached in `ai_cache`).

Browser: `pnpm app` starts the worker and the UI together (http://localhost:5173); `pnpm app:sim` does the same with the offline simulated panel, so no Gemini credit is needed. The UI reads only `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the root `.env`.

## Scripts

| Script | Purpose |
|---|---|
| `seed-demo.ts` | Synthetic brands and ads through the real API, ingest, pre-approved regions |
| `run-analysis.ts` | End to end driver. Flags: `--simulated --auto-approve --preset free\|strict --seed N --stop-at <status> --quiz-answers file.json --json` |
| `quota.ts` | Today's usage per model, cache hit rate |
| `replay.ts` | Recompute metrics and diagnosis from stored votes with other thresholds, zero model calls, prints a findings diff |
| `report.ts` | Writes `out/<analysis>/report.md`, `metrics.json` and images |
| `llm-smoke.ts` | Three real Gemini calls (detect, one panel batch, one embedding) |
| `gemini-probe.ts` | One text call per model, prints the raw error (for diagnosing keys and billing) |
| `cf-smoke.ts` | One Cloudflare image edit (needs Cloudflare credentials) |
| `rls-test.ts` | Proves user B cannot read user A's data (tables, API) |
| `contact-sheet.ts` | `tmp/contact-sheet.png`: baseline, every ablation, every Edit DSL op |
| `inspect.ts`, `queue-peek.ts` | Debug helpers |

## Generative edits (optional, Cloudflare)

Off by default. Set `ENABLE_GENERATIVE_EDITS=true`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI Read + Edit). The planner may then use one `generative_inpaint` op per plan; only a crop of that unlocked region goes to Cloudflare and the result is pasted back inside it, so nothing else can change. See ADR-017.

## Operating notes

- One worker process owns the per-model RPM limiter. Two workers on one key would need a DB-backed limiter.
- Daily quota is tracked in `ai_quota` by Pacific day; warnings fire at 70% and 90%.
- A failed job writes its error to `analyses.error` and an event; the archived pgmq message keeps the payload.
- Gemini `402` means the key's Google project has no billing credit, not a code problem.

## Known limits

- The debug UI region editor edits boxes as text; no drag handles.
- Panel `free` preset uses 2 calls per condition, so intervals are wide (the report says so).
- Cloudflare FLUX.2 multipart field names are not documented; verify with `cf-smoke.ts`.
