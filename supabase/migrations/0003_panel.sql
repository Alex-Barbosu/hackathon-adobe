create table personas (
  id text primary key,
  description text not null,
  viewing_mode text not null check (viewing_mode in ('glance', 'considered')),
  category_familiarity text not null check (category_familiarity in ('heavy', 'light', 'none'))
);

create table panel_batches (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  condition_id uuid not null references conditions(id) on delete cascade,
  batch_index int not null,
  model text not null,
  persona_ids text[] not null,
  exposure_ad_ids uuid[] not null,
  candidate_order uuid[] not null,
  status batch_status not null default 'planned',
  attempts int not null default 0,
  request_key text,
  raw_response jsonb,
  leak_flags int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (condition_id, batch_index)
);
create index panel_batches_analysis on panel_batches(analysis_id);

create table panel_votes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references panel_batches(id) on delete cascade,
  condition_id uuid not null references conditions(id) on delete cascade,
  persona_id text not null references personas(id),
  probabilities jsonb not null,
  raw_probabilities jsonb not null,
  cues jsonb not null,
  saw_identifier boolean not null default false,
  unique (batch_id, persona_id)
);
create index panel_votes_condition on panel_votes(condition_id);

create table condition_metrics (
  condition_id uuid primary key references conditions(id) on delete cascade,
  analysis_id uuid not null references analyses(id) on delete cascade,
  n_votes int not null,
  n_batches int not null,
  attribution real not null,
  attribution_ci real[] not null,
  pull jsonb not null,
  pull_ci jsonb not null,
  cue_freq jsonb not null,
  computed_at timestamptz not null default now()
);

create table element_impacts (
  analysis_id uuid not null references analyses(id) on delete cascade,
  element element_kind not null,
  delta real not null,
  delta_ci real[] not null,
  pull_shift jsonb not null,
  pull_shift_ci jsonb not null,
  label diagnosis_label not null,
  primary key (analysis_id, element)
);

create table embeddings (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('ad_masked', 'condition')),
  subject_id uuid not null,
  model text not null,
  dims int not null,
  image_sha256 text not null,
  -- Keep in sync with EMBED_DIMS; changing it requires a migration.
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id, model)
);

create table similarity (
  analysis_id uuid primary key references analyses(id) on delete cascade,
  nearest_brand_id uuid references brands(id),
  nearest_sim real not null,
  centroid_sim real not null,
  centroid_percentile real not null,
  details jsonb not null
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  finding_key text not null,
  rule text not null,
  severity int not null check (severity between 1 and 5),
  element element_kind,
  brand_id uuid references brands(id),
  evidence jsonb not null,
  unique (analysis_id, finding_key)
);
