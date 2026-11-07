-- Read-only usage for quota warnings (70% / 90% of the daily budget).
create function public.quota_used(p_model text, p_day date) returns int
  language sql stable security definer set search_path = ''
as $$
  select coalesce((select requests from public.ai_quota where model = p_model and day = p_day), 0)
$$;
revoke all on function public.quota_used(text, date) from public, anon, authenticated;
grant execute on function public.quota_used(text, date) to service_role;
