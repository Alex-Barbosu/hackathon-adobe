create table quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique references analyses(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  status text not null default 'open' check (status in ('open', 'pairwise', 'finished')),
  brief_draft jsonb not null default '{}'::jsonb,
  asked_count int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quiz_sessions(id) on delete cascade,
  key text not null,
  source question_source not null,
  type question_type not null,
  prompt text not null,
  help text,
  options jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  fills_slots text[] not null,
  required boolean not null default false,
  priority int not null default 50,
  depends_on jsonb,
  finding_key text,
  asked_at timestamptz,
  position int,
  unique (session_id, key)
);

create table quiz_answers (
  question_id uuid primary key references quiz_questions(id) on delete cascade,
  session_id uuid not null references quiz_sessions(id) on delete cascade,
  value jsonb not null,
  answered_at timestamptz not null default now()
);

create table directions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quiz_sessions(id) on delete cascade,
  title text not null,
  description text not null,
  tags text[] not null,
  elo real not null default 1000,
  comparisons int not null default 0
);

create table pairwise_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quiz_sessions(id) on delete cascade,
  round_index int not null,
  a_id uuid not null references directions(id),
  b_id uuid not null references directions(id),
  choice text check (choice in ('a', 'b', 'neither')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (session_id, round_index)
);

create table creative_briefs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references quiz_sessions(id) on delete cascade,
  analysis_id uuid not null references analyses(id) on delete cascade,
  version int not null,
  brief jsonb not null,
  brief_hash text not null,
  created_at timestamptz not null default now(),
  unique (analysis_id, version)
);
