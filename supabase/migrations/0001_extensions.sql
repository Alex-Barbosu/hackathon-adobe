create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;

create type ad_role as enum ('target', 'competitor', 'exposure');
create type region_kind as enum (
  'logo', 'brand_name', 'packaging_text', 'url_or_handle',
  'mascot_character', 'product', 'other_text', 'person', 'graphic_element'
);
create type region_source as enum ('model', 'manual');
create type element_kind as enum ('color', 'mascot_character', 'product', 'other_text', 'layout');
create type condition_kind as enum ('baseline', 'ablation', 'control_no_memory', 'variant');
create type batch_status as enum ('planned', 'running', 'done', 'failed');
create type analysis_status as enum (
  'created', 'ingesting', 'detecting', 'needs_review', 'masking',
  'testing', 'aggregating', 'diagnosed', 'quiz_ready', 'quiz_in_progress',
  'planning', 'rendering', 'retesting', 'reporting', 'done', 'failed'
);
create type question_type as enum (
  'single_choice', 'multi_choice', 'rank', 'slider', 'semantic_pair', 'palette', 'short_text', 'yes_no'
);
create type question_source as enum ('core', 'dynamic', 'clarify');
create type diagnosis_label as enum ('strong_asset', 'decoration', 'traitor', 'neutral');
