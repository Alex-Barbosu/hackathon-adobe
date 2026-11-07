# Demo runbook

## One-time setup
1. `pnpm install`
2. Copy `.env.example` to `.env` and fill `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. Set the `QUOTA_*` lines from your AI Studio rate-limit page.
3. In the Supabase dashboard enable **Authentication → Anonymous sign-ins**.
4. Migrations are already applied to the hosted project; for a new project run `supabase link --project-ref <ref>` then `supabase db push --remote --include-seed --yes`, then `supabase functions deploy api --use-api --yes`.
5. `pnpm worker --dry-run` lists every configured model as found/missing.

## Offline demo (no Gemini calls)
```
pnpm exec tsx scripts/seed-demo.ts
pnpm exec tsx scripts/run-analysis.ts --simulated --auto-approve
```
Seeds four synthetic brands (no copyrighted ads), runs the whole pipeline with the offline simulated panel, answers the quiz with recommended defaults and prints the report. The simulated panel is a colour-layout matcher, not Gemini.

## Live demo (real Gemini)
```
pnpm exec tsx scripts/seed-demo.ts
pnpm exec tsx scripts/run-analysis.ts --auto-approve --seed 7
```
A second run with the same `--seed` reads every panel answer from `ai_cache` and costs zero Gemini calls. Run `pnpm exec tsx scripts/quota.ts` to see usage.

## Browser flow
`VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... pnpm --filter @nologo/debug-ui dev`, and in another terminal `pnpm worker`. Upload ads, start an analysis, review regions, watch progress, take the quiz, read the report.

## If quota runs out
Re-run with the same seed: cached answers are reused. The report job falls back to a data-only template if the report model is unavailable.

## Optional: generative edits (Cloudflare)
Set `ENABLE_GENERATIVE_EDITS=true`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI Read + Edit). Verify with `pnpm exec tsx scripts/cf-smoke.ts`; the planner may then use `generative_inpaint` on one unlocked region per plan.

## Notice
Free-tier Gemini data may be used by Google to improve its products. Only public ads. The panel is an AI proxy, not real people.
