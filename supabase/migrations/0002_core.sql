create table brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  slug text not null,
  name text not null,
  category text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

-- Storage paths are relative to their bucket and always start with <owner_id>/.
create table ads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  brand_id uuid not null references brands(id) on delete cascade,
  original_path text not null,
  normalized_path text,
  width int,
  height int,
  sha256 text,
  status text not null default 'uploaded' check (status in ('uploaded', 'normalized', 'failed')),
  created_at timestamptz not null default now()
);
-- Dedupe is done in the ingest job (it links instead of inserting), so this is a plain lookup
-- index: a unique one would make the duplicate row itself fail when it records its hash.
create index ads_owner_sha on ads(owner_id, sha256) where sha256 is not null;
create index ads_brand on ads(brand_id);

create table analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  category text not null,
  target_ad_id uuid not null references ads(id),
  target_brand_id uuid not null references brands(id),
  status analysis_status not null default 'created',
  preset text not null default 'free' check (preset in ('free', 'strict')),
  seed bigint not null default (floor(random() * 2147483647))::bigint,
  config jsonb not null default '{}'::jsonb,
  pending_batches int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table analysis_ads (
  analysis_id uuid not null references analyses(id) on delete cascade,
  ad_id uuid not null references ads(id) on delete cascade,
  role ad_role not null,
  primary key (analysis_id, ad_id, role)
);

create table analysis_brands (
  analysis_id uuid not null references analyses(id) on delete cascade,
  brand_id uuid not null references brands(id),
  is_target boolean not null default false,
  candidate_label text not null,
  primary key (analysis_id, brand_id)
);

create table regions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ads(id) on delete cascade,
  analysis_id uuid references analyses(id) on delete cascade,
  kind region_kind not null,
  box int[] not null check (array_length(box, 1) = 4),
  label text,
  confidence real,
  source region_source not null,
  approved boolean not null default false,
  is_identifier boolean generated always as (kind in ('logo', 'brand_name', 'packaging_text', 'url_or_handle')) stored,
  created_at timestamptz not null default now()
);
create index regions_ad on regions(ad_id);
create index regions_analysis on regions(analysis_id);

create table conditions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  kind condition_kind not null,
  element element_kind,
  variant_id uuid,
  image_path text not null,
  image_sha256 text not null,
  transform jsonb not null default '{}'::jsonb,
  guard jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (analysis_id, kind, element, variant_id)
);
