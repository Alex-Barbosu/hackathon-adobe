-- All RPCs below are for the service role only (worker and api function).

create function public.bump_quota(p_model text, p_day date, p_limit int) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare granted boolean;
begin
  if p_limit < 1 then return false; end if;
  -- The WHERE on the conflict branch makes the check-and-increment atomic.
  with up as (
    insert into public.ai_quota as q (model, day, requests) values (p_model, p_day, 1)
    on conflict (model, day) do update set requests = q.requests + 1
      where q.requests < p_limit
    returning 1
  )
  select exists (select 1 from up) into granted;
  return granted;
end $$;

create function public.note_429(p_model text, p_day date) returns void
  language sql security definer set search_path = ''
as $$
  insert into public.ai_quota as q (model, day, requests, last_429_at) values (p_model, p_day, 0, now())
  on conflict (model, day) do update set last_429_at = now()
$$;

create function public.emit_event(p_analysis_id uuid, p_type text, p_payload jsonb default '{}'::jsonb) returns void
  language sql security definer set search_path = ''
as $$
  insert into public.analysis_events (analysis_id, owner_id, type, payload)
  select a.id, a.owner_id, p_type, coalesce(p_payload, '{}'::jsonb)
  from public.analyses a where a.id = p_analysis_id
$$;

-- Compare-and-set transition; every status change goes through here.
create function public.set_analysis_status(p_id uuid, p_from public.analysis_status[], p_to public.analysis_status)
  returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare prev public.analysis_status;
begin
  select status into prev from public.analyses where id = p_id for update;
  if prev is null or not (prev = any (p_from)) then return false; end if;
  update public.analyses set status = p_to, updated_at = now() where id = p_id;
  perform public.emit_event(p_id, 'status_changed', jsonb_build_object('from', prev, 'to', p_to));
  return true;
end $$;

create function public.fail_analysis(p_id uuid, p_error text) returns void
  language plpgsql security definer set search_path = ''
as $$
declare prev public.analysis_status;
begin
  select status into prev from public.analyses where id = p_id for update;
  if prev is null or prev = 'failed' then return; end if;
  update public.analyses set status = 'failed', error = left(p_error, 2000), updated_at = now() where id = p_id;
  perform public.emit_event(p_id, 'failed', jsonb_build_object('error', left(p_error, 500), 'from', prev));
end $$;

-- Idempotent: only the first call for a batch decrements the counter.
create function public.finish_batch(p_batch_id uuid) returns int
  language plpgsql security definer set search_path = ''
as $$
declare aid uuid; remaining int; was_open boolean;
begin
  update public.panel_batches set finished_at = now()
    where id = p_batch_id and finished_at is null
    returning analysis_id into aid;
  was_open := found;
  if not was_open then
    select analysis_id into aid from public.panel_batches where id = p_batch_id;
    select pending_batches into remaining from public.analyses where id = aid;
    return coalesce(remaining, 0);
  end if;
  update public.analyses set pending_batches = greatest(pending_batches - 1, 0), updated_at = now()
    where id = aid returning pending_batches into remaining;
  return remaining;
end $$;

-- Creates batches and bumps the fan-in counter in one transaction; re-running adds nothing.
-- Returns every batch of the given conditions that is not finished yet.
create function public.register_batches(p_analysis_id uuid, p_batches jsonb)
  returns table (id uuid, condition_id uuid, batch_index int)
  language plpgsql security definer set search_path = ''
as $$
declare inserted_count int;
begin
  with ins as (
    insert into public.panel_batches
      (analysis_id, condition_id, batch_index, model, persona_ids, exposure_ad_ids, candidate_order)
    select p_analysis_id, (b ->> 'condition_id')::uuid, (b ->> 'batch_index')::int, b ->> 'model',
           array(select jsonb_array_elements_text(b -> 'persona_ids')),
           array(select jsonb_array_elements_text(b -> 'exposure_ad_ids')::uuid),
           array(select jsonb_array_elements_text(b -> 'candidate_order')::uuid)
    from jsonb_array_elements(p_batches) b
    on conflict (condition_id, batch_index) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;
  update public.analyses set pending_batches = pending_batches + inserted_count, updated_at = now()
    where analyses.id = p_analysis_id;
  return query
    select pb.id, pb.condition_id, pb.batch_index from public.panel_batches pb
    where pb.analysis_id = p_analysis_id
      and pb.condition_id in (select (b ->> 'condition_id')::uuid from jsonb_array_elements(p_batches) b)
      and pb.finished_at is null;
end $$;

create function public.nearest_category_ads(p_analysis_id uuid, p_embedding extensions.vector, p_k int)
  returns table (ad_id uuid, brand_id uuid, similarity real)
  language sql stable security definer set search_path = ''
as $$
  select e.subject_id, ad.brand_id, (1 - (e.embedding operator(extensions.<=>) p_embedding))::real
  from public.embeddings e
  join public.analysis_ads aa on aa.ad_id = e.subject_id and aa.analysis_id = p_analysis_id and aa.role = 'competitor'
  join public.ads ad on ad.id = e.subject_id
  where e.subject_type = 'ad_masked'
  order by e.embedding operator(extensions.<=>) p_embedding
  limit p_k
$$;

-- Thin pgmq wrappers so only the service role touches queues (pgmq_public is not exposed).
create function public.queue_send(q text, msg jsonb, delay_s int default 0) returns bigint
  language sql security definer set search_path = ''
as $$ select * from pgmq.send(q, msg, delay_s) $$;

create function public.queue_read(q text, vt_s int, qty int)
  returns table (msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
  language sql security definer set search_path = ''
as $$ select m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message from pgmq.read(q, vt_s, qty) m $$;

create function public.queue_delete(q text, id bigint) returns boolean
  language sql security definer set search_path = ''
as $$ select pgmq.delete(q, id) $$;

create function public.queue_archive(q text, id bigint) returns boolean
  language sql security definer set search_path = ''
as $$ select pgmq.archive(q, id) $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'bump_quota', 'note_429', 'emit_event', 'set_analysis_status', 'fail_analysis', 'finish_batch',
      'register_batches', 'nearest_category_ads', 'queue_send', 'queue_read', 'queue_delete',
      'queue_archive')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

grant execute on function public.owns_analysis(uuid), public.owns_session(uuid), public.owns_ad(uuid) to authenticated;
