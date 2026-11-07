create table variants (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  brief_id uuid not null references creative_briefs(id),
  idx int not null,
  plan jsonb not null,
  hypothesis text not null,
  target_element element_kind,
  status text not null default 'planned' check (status in ('planned', 'rejected', 'rendered', 'tested', 'failed')),
  rejection_reasons jsonb,
  original_render_path text,
  change_ratio real,
  brand_fit jsonb,
  -- Retest numbers (delta vs baseline with CI, similarity change, win flag); filled by aggregate.
  metrics jsonb,
  unique (analysis_id, idx)
);
alter table conditions
  add constraint conditions_variant_fk foreign key (variant_id) references variants(id) on delete cascade;

create table reports (
  analysis_id uuid not null references analyses(id) on delete cascade,
  version int not null,
  model text not null,
  markdown text not null,
  data jsonb not null,
  number_check jsonb not null,
  created_at timestamptz not null default now(),
  primary key (analysis_id, version)
);
