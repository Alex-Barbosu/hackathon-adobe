create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references analyses(id) on delete set null,
  task text not null,
  model text not null,
  prompt_version text not null,
  cache_hit boolean not null default false,
  status text not null check (status in ('ok', 'retry', 'error', 'quota_blocked', 'schema_invalid')),
  http_status int,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  attempt int not null default 1,
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_created on ai_calls(created_at desc);

create table ai_cache (
  key text primary key,
  task text not null,
  model text not null,
  prompt_version text not null,
  response jsonb not null,
  hits int not null default 0,
  created_at timestamptz not null default now()
);

create table ai_quota (
  model text not null,
  day date not null,
  requests int not null default 0,
  last_429_at timestamptz,
  primary key (model, day)
);

create table analysis_events (
  id bigint generated always as identity primary key,
  analysis_id uuid not null references analyses(id) on delete cascade,
  owner_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index analysis_events_analysis on analysis_events(analysis_id, id);
alter publication supabase_realtime add table analysis_events;
