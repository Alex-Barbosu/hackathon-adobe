# No Logo

Answers one question for a brand: _"If you hide our logo, does this ad still belong to us?"_
Spec: [`PROMPT.md`](PROMPT.md). Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). Verified APIs: [`docs/VERIFIED_APIS.md`](docs/VERIFIED_APIS.md).

> **Data notice:** Gemini free-tier data may be used by Google to improve its products. Only public ads may go through this system. The AI panel is a proxy for human viewers, not a survey of real people.

## Setup

```sh
pnpm install
cp .env.example .env      # fill in keys; never commit .env
pnpm check                # typecheck + lint + tests
pnpm worker --dry-run     # validate env, list configured models as found/missing
```

Local Supabase (`supabase start`) needs Docker. The repo is linked to the hosted project via `supabase link`.
