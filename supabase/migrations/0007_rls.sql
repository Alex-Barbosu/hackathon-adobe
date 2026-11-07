-- The browser only reads (and subscribes to events). Every write goes through the api function,
-- which uses the service role after checking ownership. So only SELECT policies exist.

create function public.owns_analysis(p_analysis_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.analyses a where a.id = p_analysis_id and a.owner_id = (select auth.uid()))
$$;

create function public.owns_session(p_session_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.quiz_sessions s where s.id = p_session_id and s.owner_id = (select auth.uid()))
$$;

create function public.owns_ad(p_ad_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.ads a where a.id = p_ad_id and a.owner_id = (select auth.uid()))
$$;

alter table brands enable row level security;
alter table ads enable row level security;
alter table analyses enable row level security;
alter table analysis_ads enable row level security;
alter table analysis_brands enable row level security;
alter table regions enable row level security;
alter table conditions enable row level security;
alter table personas enable row level security;
alter table panel_batches enable row level security;
alter table panel_votes enable row level security;
alter table condition_metrics enable row level security;
alter table element_impacts enable row level security;
alter table embeddings enable row level security;
alter table similarity enable row level security;
alter table findings enable row level security;
alter table quiz_sessions enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_answers enable row level security;
alter table directions enable row level security;
alter table pairwise_rounds enable row level security;
alter table creative_briefs enable row level security;
alter table variants enable row level security;
alter table reports enable row level security;
alter table ai_calls enable row level security;
alter table ai_cache enable row level security;
alter table ai_quota enable row level security;
alter table analysis_events enable row level security;

create policy brands_select on brands for select to authenticated using (owner_id = (select auth.uid()));
create policy ads_select on ads for select to authenticated using (owner_id = (select auth.uid()));
create policy analyses_select on analyses for select to authenticated using (owner_id = (select auth.uid()));
create policy quiz_sessions_select on quiz_sessions for select to authenticated using (owner_id = (select auth.uid()));

create policy analysis_ads_select on analysis_ads for select to authenticated using (public.owns_analysis(analysis_id));
create policy analysis_brands_select on analysis_brands for select to authenticated using (public.owns_analysis(analysis_id));
create policy conditions_select on conditions for select to authenticated using (public.owns_analysis(analysis_id));
create policy panel_batches_select on panel_batches for select to authenticated using (public.owns_analysis(analysis_id));
create policy condition_metrics_select on condition_metrics for select to authenticated using (public.owns_analysis(analysis_id));
create policy element_impacts_select on element_impacts for select to authenticated using (public.owns_analysis(analysis_id));
create policy similarity_select on similarity for select to authenticated using (public.owns_analysis(analysis_id));
create policy findings_select on findings for select to authenticated using (public.owns_analysis(analysis_id));
create policy creative_briefs_select on creative_briefs for select to authenticated using (public.owns_analysis(analysis_id));
create policy variants_select on variants for select to authenticated using (public.owns_analysis(analysis_id));
create policy reports_select on reports for select to authenticated using (public.owns_analysis(analysis_id));
create policy analysis_events_select on analysis_events for select to authenticated using (owner_id = (select auth.uid()));

-- Regions: analysis-scoped rows follow the analysis; ad-level rows follow the ad owner.
create policy regions_select on regions for select to authenticated using (
  case when analysis_id is null then public.owns_ad(ad_id) else public.owns_analysis(analysis_id) end
);

create policy panel_votes_select on panel_votes for select to authenticated using (
  exists (select 1 from public.conditions c where c.id = condition_id and public.owns_analysis(c.analysis_id))
);

create policy quiz_questions_select on quiz_questions for select to authenticated using (public.owns_session(session_id));
create policy quiz_answers_select on quiz_answers for select to authenticated using (public.owns_session(session_id));
create policy directions_select on directions for select to authenticated using (public.owns_session(session_id));
create policy pairwise_rounds_select on pairwise_rounds for select to authenticated using (public.owns_session(session_id));

create policy personas_select on personas for select to authenticated using (true);

-- ai_calls, ai_cache, ai_quota, embeddings: RLS on, no policy => no client access.

revoke all on all tables in schema public from anon;
revoke all on ai_calls, ai_cache, ai_quota, embeddings from authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke select on ai_calls, ai_cache, ai_quota, embeddings from authenticated;
